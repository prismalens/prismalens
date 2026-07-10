// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl listen` (issue #58, Phase 1 R1) — the walking skeleton of unattended
 * investigation: a token-authed local HTTP receiver for Alertmanager webhooks.
 * Each firing alert runs the SAME seam chain as `investigate`/`serve`
 * (loadConfig → resolveRunSandbox → resolveInvestigation → conductRun with the
 * file session store), resolved PER PAYLOAD — config edits apply to the next
 * webhook without a restart. No grouping, no caps, no Slack yet (next slices).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { conductRun as engineConductRun } from "@prismalens/engine";
import { defineCommand } from "citty";
import { consola } from "consola";
import { loadConfig } from "../config/loader.js";
import type { PlConfig } from "../config/schema.js";
import { resolveRepoSlug } from "../core/detect-repo.js";
import { createFileSessionStore } from "../core/file-session-store.js";
import {
	pickServiceLabel,
	resolveInvestigation,
} from "../core/run-investigation.js";
import { createSessionManager } from "../core/session.js";
import {
	type ListenServer,
	startListenServer,
	WEBHOOK_PATH,
} from "../http/server.js";
import { createGroupingLayer } from "./grouping.js";
import {
	liveTimelineEntry,
	resolveRunSandbox as realResolveRunSandbox,
} from "./investigate.js";

export interface InvestigationRunnerOptions {
	/** Project dir each run resolves config + repo against. Default: process.cwd(). */
	cwd?: string;
	/** Explicit config file path (else the loader's global→project hierarchy). */
	configPath?: string;
	/** One line per streamed canonical event (the live timeline). */
	log: (line: string) => void;
}

/**
 * The two external boundaries of the chain, injectable for tests: `conductRun`
 * spawns a harness, `resolveRunSandbox` probes/arms a sandbox. Everything else
 * (config loader, resolver, file store) runs real.
 */
export interface InvestigationRunnerDeps {
	conductRun?: typeof engineConductRun;
	resolveRunSandbox?: typeof realResolveRunSandbox;
}

/**
 * Build the per-alert investigation executor the intake server drives — the
 * `handleInvestigate` chain (jsonrpc/server.ts) minus the RPC framing. Rejects
 * on a failed run (the server logs it and keeps serving); the sandbox is
 * CALLER-OWNED and destroyed in `finally` (ADR-0020), matching investigate/serve.
 */
/**
 * Per-payload repo/cwd resolution (issue #58 AC5): the alert's service label
 * (`service`/`namespace`/`job`) → `services[name].repo` → a `repos` entry's
 * `local_path`, else the value itself when it is an existing local checkout.
 * No label / no catalog match / no checkout ⇒ the listen cwd, exactly like a
 * manual `pl investigate` run from that directory (single-player default).
 */
export function resolveRepoPath(
	alert: Record<string, unknown>,
	config: PlConfig,
	fallbackCwd: string,
): string {
	const name = pickServiceLabel(alert);
	const repoRef = name ? config.services[name]?.repo : undefined;
	if (!repoRef) return fallbackCwd;
	const localPath = config.repos[repoRef]?.local_path;
	if (localPath) return resolve(localPath);
	if (existsSync(repoRef)) return resolve(repoRef);
	return fallbackCwd;
}

export function createInvestigationRunner(
	options: InvestigationRunnerOptions,
	deps: InvestigationRunnerDeps = {},
): (runId: string, alerts: Record<string, unknown>[]) => Promise<void> {
	const conductRun = deps.conductRun ?? engineConductRun;
	const resolveRunSandbox = deps.resolveRunSandbox ?? realResolveRunSandbox;
	const cwd = options.cwd ? resolve(options.cwd) : process.cwd();

	return async (runId, alerts) => {
		// Per payload, not once at startup: config (and thus repo/workspace/harness)
		// is re-resolved for every alert, exactly like a fresh `pl investigate`.
		const config = await loadConfig({
			cwd,
			...(options.configPath ? { configPath: options.configPath } : {}),
		});

		// AC5: the checkout under investigation follows the ALERT (service label →
		// catalog), not the directory the server happened to start in.
		const repoPath = resolveRepoPath(alerts[0], config, cwd);

		const harnessName = config.agent.default;
		const { selection } = await resolveRunSandbox(
			harnessName,
			config.agent.sandbox,
			config,
		);
		try {
			const resolved = resolveInvestigation(
				{
					alerts,
					repo: repoPath,
					...(selection
						? {
								sandbox: selection.sandbox,
								requestedSandbox: selection.requested,
							}
						: {}),
				},
				config,
			);
			const { context, harness, synth, fidelity, maxBranches } = resolved;
			const primaryAlert = context.alerts[0];

			const repoSlug = await resolveRepoSlug(config.repo, repoPath);
			const sessions = createSessionManager(config.workspace.base_dir);
			const fileSession = createFileSessionStore(sessions, {
				runId,
				alertname: primaryAlert.alertname,
				agent: resolved.harnessName,
				...(repoSlug ? { repo: repoSlug } : {}),
			});

			options.log(
				`Investigating "${primaryAlert.alertname}" with ${resolved.harnessName} in ${repoPath} (run ${runId})`,
			);
			const outcome = await conductRun(
				{
					context,
					harness,
					synth,
					fidelity,
					runId,
					...(maxBranches !== undefined ? { maxBranches } : {}),
				},
				{
					sink: (event) => {
						const entry = liveTimelineEntry(event);
						if (entry) options.log(entry);
					},
					store: fileSession.store,
				},
			);

			if (!outcome.report) {
				throw new Error(outcome.error ?? "investigation produced no evidence");
			}
			options.log(`Report saved for run ${runId}`);
		} finally {
			// The listen path owns the boundary's lifecycle (ADR-0020) — torn down
			// whichever way the run exited (report, no-evidence, error, or throw).
			if (selection) await selection.sandbox.destroy();
		}
	};
}

/**
 * The command body behind `pl listen`, separated from citty so it's testable:
 * load config, demand a token, start the intake server wired to the real (or
 * injected) investigation chain. Returns the running server (the caller owns
 * `close()`; the CLI just lets it hold the event loop open).
 */
export async function startListenFromConfig(
	options: InvestigationRunnerOptions,
	deps: InvestigationRunnerDeps = {},
): Promise<ListenServer> {
	const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
	const config = await loadConfig({
		cwd,
		...(options.configPath ? { configPath: options.configPath } : {}),
	});
	if (!config.listen.token) {
		// An open intake is not a mode — refuse to start rather than serve unauthenticated.
		throw new Error(
			"listen.token is not configured — set it in prismalens.config.yaml " +
				'(e.g. token: "${PRISMALENS_LISTEN_TOKEN}") before starting pl listen.',
		);
	}
	const sessions = createSessionManager(config.workspace.base_dir);
	const grouping = createGroupingLayer({
		windowMs: config.listen.grouping_window_ms,
		sessions,
		runInvestigation: createInvestigationRunner(options, deps),
		log: options.log,
	});

	return startListenServer({
		port: config.listen.port,
		token: config.listen.token,
		maxPending: config.listen.max_pending,
		grouping,
	});
}

export default defineCommand({
	meta: {
		name: "listen",
		description:
			"Start a token-authed local HTTP listener for Alertmanager webhooks; each firing alert triggers an investigation (Phase 1 R1).",
	},
	args: {
		config: {
			type: "string",
			description:
				"Path to prismalens.config.yaml (else global→project hierarchy).",
		},
	},
	/* v8 ignore start — process-global glue (cwd + consola binding); the body it
	   delegates to is fully covered via startListenFromConfig tests */
	async run({ args }) {
		const server = await startListenFromConfig({
			cwd: process.cwd(),
			...(args.config ? { configPath: args.config } : {}),
			log: (line) => consola.log(line),
		});
		consola.success(
			`Listening for Alertmanager webhooks on http://127.0.0.1:${server.port}${WEBHOOK_PATH}`,
		);
	},
	/* v8 ignore stop */
});
