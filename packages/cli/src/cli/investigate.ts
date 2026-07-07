// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens investigate` — the core investigation command (ADR-0008/0010).
 *
 * Seeds a read-only root-cause investigation from a firing alert (piped on stdin
 * as a FiringAlert JSON, or synthesized from `--query`), rents a Tier-2 harness
 * (deepagents over ACP, or Claude Code over the Agent SDK), drives the Tier-1
 * supervisor LIVE via the shared conductor (`conductRun`, ADR-0018), and renders
 * the ordered-evidence report (ADR-0002).
 *
 * BYO-key (ADR-0006): provider creds come from the environment
 * (OLLAMA_ / OPENAI_ vars), never hard-bound here. The harness investigates
 * READ-ONLY.
 *
 * LIVE (ADR-0007/0010): `conductRun` fans each CanonicalEvent to a file-session
 * STORE (append) and a terminal-line SINK, then this command renders the
 * synthesized report once the run resolves. The ~/.prismalens workspace stays as
 * the durable record.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import type {
	CanonicalEvent,
	Hypothesis,
	InvestigationReport,
	NextStep,
	RuledOut,
} from "@prismalens/contracts";
import {
	conductRun,
	resolveSandbox,
	SANDBOX_MODES,
	type SandboxMode,
	type SandboxSelection,
} from "@prismalens/engine";
import { defineCommand } from "citty";
import consola from "consola";
import { loadConfig } from "../config/loader.js";
import type { PlConfig } from "../config/schema.js";
import { resolveRepoSlug } from "../core/detect-repo.js";
import { createFileSessionStore } from "../core/file-session-store.js";
import { parseStdin } from "../core/parse-stdin.js";
import {
	type ResolvedInvestigation,
	resolveInvestigation,
} from "../core/run-investigation.js";
import { createSessionManager } from "../core/session.js";

export default defineCommand({
	meta: {
		name: "investigate",
		description:
			"Run a read-only root-cause investigation of a firing alert (two-tier engine, ADR-0008).",
	},
	args: {
		repo: {
			type: "string",
			description:
				"Path to the repository the harness investigates (its cwd). Defaults to the current directory.",
		},
		query: {
			type: "string",
			alias: "q",
			description:
				"Investigate a synthesized alert from this one-line description (alternative to piping a FiringAlert JSON on stdin).",
		},
		config: {
			type: "string",
			description:
				"Path to a prismalens.config.yaml (skips the upward config search).",
		},
		model: {
			type: "string",
			description: "Override agent.model — a bare model id, e.g. gpt-oss:120b.",
		},
		harness: {
			type: "enum",
			options: ["deepagents", "claude-code", "codex"],
			description:
				"Tier-2 harness backend. Defaults to agent.default in config.",
		},
		mode: {
			type: "enum",
			options: ["read-only", "supervised", "auto", "dangerous"],
			description:
				"Permission posture the harness runs under (ADR-0017). Defaults to agent.permissions.mode in config (read-only).",
		},
		dangerouslySkipPermissions: {
			type: "boolean",
			default: false,
			description: "Alias for --mode dangerous.",
		},
		sandbox: {
			type: "enum",
			options: [...SANDBOX_MODES],
			description:
				"Isolation boundary the harness runs in (ADR-0020): process (cooperative floor), srt (enforced), or auto. Defaults to agent.sandbox in config (auto — srt when its egress bridge is healthy, else the process floor).",
		},
		service: {
			type: "string",
			description:
				"Select the service context by name from `services` in config (overrides the alert's service label).",
		},
		json: {
			type: "boolean",
			default: false,
			description:
				"Print the InvestigationReport as JSON to stdout (suppresses the human renderer).",
		},
		output: {
			type: "string",
			description: "Write the InvestigationReport JSON to this file.",
		},
		quiet: {
			type: "boolean",
			default: false,
			description:
				"Suppress progress + the human renderer (errors still go to stderr).",
		},
	},
	async run({ args }) {
		const json = Boolean(args.json);
		// In --json mode stdout must be machine-clean, so suppress all info-level
		// chatter (consola routes info/log/success to stdout, warn/error to stderr).
		// The AI SDK's stdout warning banner is disabled bin-wide (bin/prismalens.ts).
		const quiet = Boolean(args.quiet) || json;
		const info = (msg: string): void => {
			if (!quiet) consola.info(msg);
		};
		const success = (msg: string): void => {
			if (!quiet) consola.success(msg);
		};
		// One-line live timeline entries (no consola icon, so the stream reads cleanly).
		const line = (msg: string): void => {
			if (!quiet) consola.log(msg);
		};

		// (1) Resolve the seed alert + config + harness + reduce model. The seed is a
		// piped FiringAlert JSON (the stdin channel) or, failing that, --query.
		const piped = await parseStdin();

		// cwd = --repo (a local repo path) else the current directory.
		const cwd = args.repo ? resolve(args.repo) : process.cwd();

		// Load + merge config (global → project → CLI overrides); --model overrides agent.model.
		const config = await loadConfig({
			...(args.config ? { configPath: args.config } : {}),
			cwd,
			cliOverrides: { ...(args.model ? { model: args.model } : {}) },
		});

		// Session label: config `repo` (owner/name) wins; else git auto-detect; else none.
		const repoSlug = await resolveRepoSlug(config.repo, cwd);

		// The single posture dial (ADR-0017): --dangerously-skip-permissions wins over
		// --mode, aliasing straight to "dangerous".
		const permissionMode = args.dangerouslySkipPermissions
			? "dangerous"
			: args.mode;

		// Resolve the isolation boundary (ADR-0020): --sandbox wins over agent.sandbox.
		// Only ACP-transport harnesses are spawned as a child the engine can place
		// inside a boundary (the Agent SDK harness runs in-process). Fail fast ONLY when
		// the mode DEMANDS an enforced boundary (`srt`/`e2b`) a non-ACP harness cannot
		// honour (ADR-0017 — never claim an enforcement that would not apply). `auto` and
		// `process` with a non-ACP harness run WITHOUT a sandbox silently: `auto` means
		// best-effort, and the best available for an in-process harness is none — nothing
		// is claimed, so nothing is dishonest. The sandbox is CALLER-OWNED — destroyed in
		// the finally.
		const harnessName =
			(args.harness as HarnessId | undefined) ?? config.agent.default;
		const sandboxMode =
			(args.sandbox as SandboxMode | undefined) ?? config.agent.sandbox;
		let selection: SandboxSelection | null = null;
		try {
			const resolvedSandbox = await resolveRunSandbox(
				harnessName,
				sandboxMode,
				config,
			);
			selection = resolvedSandbox.selection;
			// Honest fidelity (ADR-0017): a silent degrade would mislead — name it, with
			// the self-check's reason (srt absent, or its egress bridge dead — B.1.1).
			if (selection && resolvedSandbox.degradeReason) {
				consola.warn(
					`Sandbox 'auto' degraded to the ${selection.actual} (cooperative, not an OS boundary): ${resolvedSandbox.degradeReason}.`,
				);
			} else if (selection?.actual === "srt") {
				info("Sandbox: srt (enforced OS boundary).");
			}
		} catch (err) {
			consola.error(err instanceof Error ? err.message : String(err));
			process.exitCode = 1;
			return;
		}

		try {
			let resolved: ResolvedInvestigation;
			try {
				resolved = resolveInvestigation(
					{
						...(piped ? { alert: piped } : {}),
						...(args.query ? { query: args.query } : {}),
						...(args.repo ? { repo: args.repo } : {}),
						...(args.harness ? { harness: args.harness } : {}),
						...(args.service ? { service: args.service } : {}),
						...(permissionMode ? { permissionMode } : {}),
						...(selection
							? {
									sandbox: selection.sandbox,
									requestedSandbox: selection.requested,
								}
							: {}),
					},
					config,
				);
			} catch (err) {
				consola.error(err instanceof Error ? err.message : String(err));
				process.exitCode = 1;
				return;
			}
			const { context, harness, synth, harnessName, fidelity, maxBranches } =
				resolved;
			const primaryAlert = context.alerts[0];

			if (!synth.apiKey) {
				consola.warn(
					"No OLLAMA_API_KEY / OPENAI_API_KEY in the environment — the synthesis call will likely fail (BYO-key, ADR-0006).",
				);
			}

			// (2) Create the run workspace + session under workspace.base_dir, wrapped as
			// a conductRun store adapter (ADR-0018).
			const runId = randomUUID();
			const sessions = createSessionManager(config.workspace.base_dir);
			const fileSession = createFileSessionStore(sessions, {
				runId,
				alertname: primaryAlert.alertname,
				agent: harnessName,
				...(repoSlug ? { repo: repoSlug } : {}),
			});

			info(
				`Investigating "${primaryAlert.alertname}" with ${harnessName} in ${cwd} (run ${runId})`,
			);

			// (3) Drive the supervisor LIVE via the shared conductor: print a one-line
			// timeline entry per event; conductRun owns persistence + the terminal
			// report/no-evidence/error outcome.
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
						if (entry) line(entry);
					},
					store: fileSession.store,
				},
			);

			if (!outcome.report) {
				consola.error(outcome.error);
				process.exitCode = 1;
				return;
			}
			const report = outcome.report;

			// (4) Output. --output writes report JSON to a file; --json prints it to
			// stdout; otherwise render the ordered-evidence report for humans.
			if (args.output) {
				const outPath = resolve(args.output);
				await writeFile(
					outPath,
					`${JSON.stringify(report, null, 2)}\n`,
					"utf-8",
				);
				success(`Report written to ${outPath}`);
			}

			if (json) {
				process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
				return;
			}

			if (!quiet) {
				renderReport(report);
				success(
					`Report saved to ${join(fileSession.workspacePath(), "report.json")}`,
				);
			}
		} finally {
			// The command owns the resolved boundary's lifecycle (ADR-0020) — tear it
			// down whichever way the run exited (report, no-evidence, error, or throw).
			if (selection) await selection.sandbox.destroy();
		}
	},
});

/**
 * The egress allowlist for an enforced sandbox (ADR-0020: allowlist, not closed) — the
 * hostnames of every surface the harness will ACTUALLY contact: its own LLM endpoint
 * (BYO-key baseURL, env override included) PLUS the read-only telemetry + log surfaces.
 * The LLM + telemetry hosts carry the SAME `INVESTIGATION_DEFAULTS` fallback the request
 * assembly applies (`run-investigation`), because an unset config field still resolves to
 * a default the harness queries — omitting it hard-denied the model call and default
 * telemetry, so every branch failed with no report. Mirrors the worker's
 * `deriveWorkerAllowedHosts`. Non-URL values are skipped (no egress hole from a malformed
 * endpoint); the `process` floor ignores this.
 */
export function collectAllowedDomains(config: PlConfig): string[] {
	// The LLM endpoint the harness itself calls (BYO-key, ADR-0006): env override wins,
	// else the shared synth default — the SAME resolution as `run-investigation`.
	const llmBaseUrl =
		process.env.OLLAMA_BASE_URL ??
		process.env.OPENAI_BASE_URL ??
		INVESTIGATION_DEFAULTS.synth.baseURL;
	const urls = [
		llmBaseUrl,
		config.telemetry.prometheusUrl ??
			INVESTIGATION_DEFAULTS.telemetry.prometheusUrl,
		config.telemetry.alertmanagerUrl ??
			INVESTIGATION_DEFAULTS.telemetry.alertmanagerUrl,
		config.telemetry.apiUrl ?? INVESTIGATION_DEFAULTS.telemetry.apiUrl,
		config.logs.url,
	];
	const hosts = new Set<string>();
	for (const url of urls) {
		if (!url) continue;
		try {
			hosts.add(new URL(url).hostname);
		} catch {
			// not a parseable URL — skip; no egress hole from a malformed endpoint
		}
	}
	return [...hosts];
}

/**
 * Resolve the isolation boundary for a run (ADR-0020/0017) — the single sandbox-resolution
 * path shared by the `investigate` command and the JSON-RPC `serve` handler, so both honour
 * `agent.sandbox` (and `--sandbox`) with identical semantics. Guards first: a mode that
 * DEMANDS enforcement (`srt`/`e2b`) on a non-ACP (in-process) harness THROWS — the caller
 * maps it to its own channel (CLI stderr+exit, or a JSON-RPC error), never a silent floor.
 * Then resolves a boundary ONLY for an ACP harness; an in-process harness returns a null
 * selection (it runs on the cooperative floor, claiming nothing — nothing dishonest). The
 * returned `selection` is CALLER-OWNED — destroy it after the run. `degradeReason` is the
 * honest note when `auto` fell short of srt (present only on a degrade).
 */
export async function resolveRunSandbox(
	harness: HarnessId,
	mode: SandboxMode,
	config: PlConfig,
): Promise<{
	selection: SandboxSelection | null;
	degradeReason: string | null;
}> {
	const guard = resolveSandboxGuard(harness, mode);
	if (guard.blocked) {
		throw new Error(
			`Harness "${harness}" cannot run inside an enforced sandbox (${mode}) yet ` +
				`— it is not spawned as a child process. Use the auto or process sandbox ` +
				`mode (no enforced boundary), or an ACP harness (deepagents).`,
		);
	}
	if (!guard.takesSandbox) return { selection: null, degradeReason: null };
	const probeUrl = firstProbeUrl(config);
	const selection = await resolveSandbox(mode, {
		allowedDomains: collectAllowedDomains(config),
		...(probeUrl ? { probeUrl } : {}),
	});
	const degradeReason =
		mode === "auto" && selection.actual !== "srt"
			? (selection.degradeReason ?? "srt unavailable")
			: null;
	return { selection, degradeReason };
}

/**
 * The egress SELF-CHECK target (ADR-0020 B.1.1): the FIRST configured, parseable FULL URL
 * among the telemetry + log surfaces — handed to `auto` as `probeUrl` so its throwaway srt
 * boundary curls a REAL endpoint (not a fabricated `https://<host>/`). Kept as a full URL
 * on purpose (path/port matter for the probe); `undefined` when nothing is configured, in
 * which case `auto` floors rather than standing up a zero-egress boundary (FIX 6).
 */
function firstProbeUrl(config: PlConfig): string | undefined {
	const urls = [
		config.telemetry.prometheusUrl,
		config.telemetry.alertmanagerUrl,
		config.telemetry.apiUrl,
		config.logs.url,
	];
	for (const url of urls) {
		if (!url) continue;
		try {
			return new URL(url).href;
		} catch {
			// not a parseable URL — skip; a malformed endpoint is no probe target
		}
	}
	return undefined;
}

/**
 * The sandbox guard (ADR-0020/0017), mirrored in the worker's `harnessTakesSandbox`: only
 * ACP-transport harnesses are spawned as a child the engine can place inside a boundary.
 * Returns whether this harness `takesSandbox` and whether the request is `blocked` — the
 * fail-fast case where a mode that DEMANDS an enforced boundary (`srt`/`e2b`) was asked of a
 * non-ACP harness. `auto`/`process` are never blocked: they run WITHOUT a sandbox on an
 * in-process harness, claiming nothing, so nothing is dishonest.
 */
export function resolveSandboxGuard(
	harness: HarnessId,
	mode: SandboxMode,
): { takesSandbox: boolean; blocked: boolean } {
	const takesSandbox = HARNESS_REGISTRY[harness]?.transport === "acp";
	const demandsEnforcedBoundary = mode === "srt" || mode === "e2b";
	return { takesSandbox, blocked: !takesSandbox && demandsEnforcedBoundary };
}

// ---------------------------------------------------------------------------
// Live timeline (one line per streamed canonical event)
// ---------------------------------------------------------------------------

/**
 * Render one live-timeline line for a streamed canonical event, or null when the
 * event carries nothing worth a line (an agent_step with neither text nor calls).
 * The terminal `report` event is captured by the caller, not lined here.
 */
function liveTimelineEntry(event: CanonicalEvent): string | null {
	switch (event.kind) {
		case "agent_step": {
			const firstLine = event.text.trim().split("\n", 1)[0]?.trim() ?? "";
			const n = event.toolCalls.length;
			if (!firstLine && n === 0) return null;
			const calls = n > 0 ? ` + ${n} tool call${n === 1 ? "" : "s"}` : "";
			return `• ${firstLine}${calls}`;
		}
		case "tool_result":
			return `  ${event.result.ok ? "ok" : "ERR"} ${event.result.source}`;
		case "branch_done":
			return `  [branch ${event.reason}]`;
		case "error":
			return `  [error] ${event.message}`;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Terminal renderer (ordered-evidence report, ADR-0002)
// ---------------------------------------------------------------------------

const HYPOTHESIS_MARK: Record<Hypothesis["status"], string> = {
	confirmed: "[confirmed]",
	supported: "[supported]",
	speculative: "[speculative]",
	refuted: "[refuted]",
};

function renderReport(report: InvestigationReport): void {
	consola.log("");
	consola.log("=== Investigation Report ===");
	consola.log(report.summary);

	consola.log("");
	if (report.rootCause) {
		const cat = report.rootCauseCategory
			? ` [${report.rootCauseCategory}]`
			: "";
		consola.log(`Root cause${cat}:`);
		consola.log(`  ${report.rootCause}`);
	} else {
		consola.log("Root cause: not determined");
	}

	if (report.hypotheses.length > 0) {
		consola.log("");
		consola.log("Hypotheses (most -> least plausible):");
		report.hypotheses.forEach((h, i) => {
			renderHypothesis(h, i + 1);
		});
	}

	if (report.ruledOut.length > 0) {
		consola.log("");
		consola.log("Ruled out:");
		for (const r of report.ruledOut) renderRuledOut(r);
	}

	const { queried, notQueried } = report.coverage;
	if (queried.length > 0 || notQueried.length > 0) {
		consola.log("");
		consola.log(
			`Coverage: ${queried.length} source(s) queried, ${notQueried.length} not queried.`,
		);
	}

	if (report.nextSteps.length > 0) {
		consola.log("");
		consola.log("Next steps:");
		for (const s of report.nextSteps) renderNextStep(s);
	}
}

function renderHypothesis(h: Hypothesis, n: number): void {
	consola.log(`  ${n}. ${HYPOTHESIS_MARK[h.status]} ${h.statement}`);
	for (const e of h.evidence) {
		const sign = e.direction === "supports" ? "+" : "-";
		consola.log(`       ${sign} (${e.status}) ${e.observation}  [${e.source}]`);
	}
}

function renderRuledOut(r: RuledOut): void {
	consola.log(`  x ${r.statement} — ${r.why}`);
	for (const e of r.evidence) {
		consola.log(`       - (${e.status}) ${e.observation}  [${e.source}]`);
	}
}

function renderNextStep(s: NextStep): void {
	const prio = s.priority ? `[${s.priority}] ` : "";
	consola.log(`  * ${prio}${s.title}: ${s.detail}`);
}
