// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl listen` (issue #58, Phase 1 R1) — the walking skeleton of unattended
 * investigation: a token-authed local HTTP receiver for Alertmanager webhooks.
 * Each firing alert runs the SAME seam chain as `investigate`/`serve`
 * (loadConfig → resolveRunSandbox → resolveInvestigation → conductRun with the
 * file session store), resolved PER PAYLOAD — config edits apply to the next
 * webhook without a restart. Alert grouping via a debounce window is implemented;
 * global caps (#62) and Slack notification are still future slices.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { conductRun as engineConductRun } from "@prismalens/engine";
import { defineCommand } from "citty";
import { consola } from "consola";
import { loadConfig } from "../config/loader.js";
import type { PlConfig } from "../config/schema.js";
import {
	type CapsGate,
	createCapsGate,
	type DispatchCaps,
} from "../core/caps.js";
import { resolveRepoSlug } from "../core/detect-repo.js";
import { createFileSessionStore } from "../core/file-session-store.js";
import {
	isSynthConfigured,
	pickServiceLabel,
	resolveInvestigation,
} from "../core/run-investigation.js";
import { createSessionManager, type SessionManager } from "../core/session.js";
import {
	type ListenServer,
	startListenServer,
	WEBHOOK_PATH,
} from "../http/server.js";
import { assertKnownFlags } from "./flags.js";
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
	/** Bind host (overrides config). */
	host?: string;
	/** One line per streamed canonical event (the live timeline). */
	log: (line: string) => void;
}

import type { ConductedOutcome } from "@prismalens/engine";
/**
 * The two external boundaries of the chain, injectable for tests: `conductRun`
 * spawns a harness, `resolveRunSandbox` probes/arms a sandbox. Everything else
 * (config loader, resolver, file store) runs real.
 */
import { notifyRun } from "../core/slack-notify.js";

export interface InvestigationRunnerDeps {
	conductRun?: typeof engineConductRun;
	resolveRunSandbox?: typeof realResolveRunSandbox;
	notify?: (
		webhookUrl: string,
		alertname: string,
		outcome: ConductedOutcome,
	) => Promise<void>;
	capsGate?: CapsGate;
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
): string {
	const name = pickServiceLabel(alert);
	if (!name) {
		throw new Error(
			`Listen dispatch refused: alert is missing a service label (cannot resolve an investigation workspace).`,
		);
	}
	const repoRef = config.services[name]?.repo;
	if (!repoRef) {
		throw new Error(
			`Listen dispatch refused: service "${name}" has no mapped repo in config (cannot resolve an investigation workspace).`,
		);
	}
	const localPath = config.repos[repoRef]?.local_path;
	if (localPath) return resolve(localPath);
	if (existsSync(repoRef)) return resolve(repoRef);
	throw new Error(
		`Listen dispatch refused: repo "${repoRef}" (mapped from service "${name}") does not exist locally (cannot resolve an investigation workspace).`,
	);
}

export function createInvestigationRunner(
	options: InvestigationRunnerOptions,
	deps: InvestigationRunnerDeps = {},
): (runId: string, alerts: Record<string, unknown>[]) => Promise<void> {
	const conductRun = deps.conductRun ?? engineConductRun;
	const resolveRunSandbox = deps.resolveRunSandbox ?? realResolveRunSandbox;
	const notify = deps.notify ?? notifyRun;
	const cwd = options.cwd ? resolve(options.cwd) : process.cwd();

	// One gate for the server's lifetime; state (active count + hourly window)
	// persists across payloads even though config is re-resolved per payload.
	const caps: CapsGate = deps.capsGate ?? createCapsGate();

	return async (runId, alerts) => {
		// Per payload, not once at startup: config (and thus repo/workspace/harness)
		// is re-resolved for every alert, exactly like a fresh `pl investigate`.
		const config = await loadConfig({
			cwd,
			...(options.configPath ? { configPath: options.configPath } : {}),
		});

		const alertname = ((
			alerts[0]?.labels as Record<string, unknown> | undefined
		)?.alertname ?? undefined) as string | undefined;

		// AC5: the checkout under investigation follows the ALERT (service label →
		// catalog), not the directory the server happened to start in.
		// MUST be resolved before consuming caps so unmapped alerts do not exhaust budget.
		let repoPath: string;
		try {
			repoPath = resolveRepoPath(alerts[0], config);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			console.error(
				JSON.stringify({
					event: "dispatch_refused",
					runId,
					reason,
					...(alertname ? { alertname } : {}),
				}),
			);
			options.log(`Refused run ${runId} (${reason})`);
			const refusedSessions = createSessionManager(config.workspace.base_dir);
			try {
				await refusedSessions.recordSuppressed({
					runId,
					reason,
					...(alertname ? { alertname } : {}),
				});
			} finally {
				refusedSessions.close?.();
			}
			return; // refused, never consume caps
		}

		const dispatchCaps: DispatchCaps = {
			maxConcurrent: config.listen.caps.max_concurrent,
			maxPerHour: config.listen.caps.max_per_hour,
		};
		const decision = caps.tryDispatch(dispatchCaps, Date.now());
		if (!decision.allow) {
			// Structured suppression log — match the repo convention
			// (slack-notify.ts: console.error(JSON.stringify({ event, ... }))).
			console.error(
				JSON.stringify({
					event: "dispatch_suppressed",
					runId,
					reason: decision.reason,
					...(alertname ? { alertname } : {}),
					maxConcurrent: dispatchCaps.maxConcurrent,
					maxPerHour: dispatchCaps.maxPerHour,
				}),
			);
			options.log(`Suppressed run ${runId} (${decision.reason} cap)`);
			const suppressedSessions = createSessionManager(
				config.workspace.base_dir,
			);
			try {
				await suppressedSessions.recordSuppressed({
					runId,
					reason: decision.reason,
					...(alertname ? { alertname } : {}),
				});
			} finally {
				suppressedSessions.close?.();
			}
			return; // never arm a sandbox / call conductRun for a suppressed run
		}

		const harnessName = config.agent.default;
		const { selection } = await resolveRunSandbox(
			harnessName,
			config.agent.sandbox,
			config,
		);
		let sessions: SessionManager | undefined;
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
					...(config.listen.caps.max_turns !== undefined
						? { maxTurns: config.listen.caps.max_turns }
						: {}),
					isolateSettings: true,
				},
				config,
			);
			const { context, harness, synth, fidelity, maxBranches } = resolved;
			const primaryAlert = context.alerts[0];

			const repoSlug = await resolveRepoSlug(config.repo, repoPath);
			sessions = createSessionManager(config.workspace.base_dir);
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

			if (config.listen.slack_webhook_url) {
				try {
					await notify(
						config.listen.slack_webhook_url,
						primaryAlert.alertname as string,
						outcome,
					);
				} catch (err) {
					// Fallback for an injected notify that violates the contract.
					// The real notifyRun never rejects.
					options.log(`Slack notification failed with error: ${err}`);
				}
			}

			if (!outcome.report) {
				throw new Error(outcome.error ?? "investigation produced no evidence");
			}
			options.log(`Report saved for run ${runId}`);
		} finally {
			caps.release();
			// Close this run's sqlite connection — the runner opens one PER alert,
			// so leaving it open would leak a handle on every webhook.
			sessions?.close?.();
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

	if (!isSynthConfigured(config)) {
		options.log(
			"No Tier-1 provider configured (checked env + _FILE for: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY, OLLAMA_API_KEY) — reports will be RAW harness pass-through (un-synthesized). This is supported.",
		);
	}

	if (!config.listen.token) {
		// An open intake is not a mode — refuse to start rather than serve unauthenticated.
		throw new Error(
			"config is missing listen.token (required — intake auth). Add listen.token to prismalens.config.yaml.",
		);
	}
	const sessions = createSessionManager(config.workspace.base_dir);

	// Startup reaper (#136): mark any orphaned "running" runs from a previous
	// dead listener as errored, so pl status reflects reality.
	const staleRuns = await sessions.list({ status: ["running"] });
	// Liveness guard: only reap runs whose updatedAt is older than the max possible
	// run duration (wall-clock cap if configured, else 1 hour) plus 5 minutes slack.
	const runWallClockMs = config.agent.limits.wall_clock_ms || 60 * 60 * 1000;
	const staleThresholdMs = runWallClockMs + 5 * 60 * 1000;
	const now = Date.now();

	for (const run of staleRuns) {
		const updatedTime = new Date(run.updatedAt).getTime();
		if (now - updatedTime > staleThresholdMs) {
			await sessions.update(run.runId, {
				status: "errored",
				error: "listener process died mid-investigation (interrupted)",
			});
			options.log(`Reaped stale run ${run.runId} from a previous listener`);
		}
	}

	const grouping = createGroupingLayer({
		windowMs: config.listen.grouping_window_ms,
		sessions,
		runInvestigation: createInvestigationRunner(options, deps),
		log: options.log,
	});

	const server = await startListenServer({
		host: options.host ?? config.listen.host,
		port: config.listen.port,
		token: config.listen.token,
		maxPending: config.listen.max_pending,
		grouping,
		log: options.log,
	});

	// grouping holds a connection for the server's lifetime; release it on close
	// (server.close already drains grouping via shutdown()).
	return {
		...server,
		async close() {
			await server.close();
			sessions.close?.();
		},
	};
}

export default defineCommand({
	meta: {
		name: "listen",
		description:
			"Start a token-authed local HTTP listener for Alertmanager webhooks; each firing alert triggers an investigation (Phase 1 R1).\n\nExamples:\n  $ PRISMALENS_LISTEN_TOKEN=xyz pl listen --config my-stack.yaml",
	},
	args: {
		config: {
			type: "string",
			description:
				"Path to prismalens.config.yaml (else global→project hierarchy).",
		},
		host: {
			type: "string",
			description: "Bind host (default 127.0.0.1).",
		},
	},
	/* v8 ignore start — process-global glue (cwd + consola binding); the body it
	   delegates to is fully covered via startListenFromConfig tests */
	async run({ args, cmd }) {
		try {
			assertKnownFlags(args, cmd);

			const server = await startListenFromConfig({
				cwd: process.cwd(),
				...(args.config ? { configPath: args.config } : {}),
				...(args.host ? { host: args.host } : {}),
				log: (line) => consola.log(line),
			});
			consola.success(
				`Listening for Alertmanager webhooks on http://${server.host}:${server.port}${WEBHOOK_PATH}`,
			);
		} catch (err) {
			consola.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		}
	},
	/* v8 ignore stop */
});
