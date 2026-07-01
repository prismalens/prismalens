/**
 * `prismalens investigate` — the core investigation command (ADR-0008/0010).
 *
 * Seeds a read-only root-cause investigation from a firing alert (piped on stdin
 * as a FiringAlert JSON, or synthesized from `--query`), rents a Tier-2 harness
 * (deepagents over ACP, or Claude Code over the Agent SDK), drives the Tier-1
 * supervisor LIVE (`investigateIncidentStream`), persists each canonical event as
 * it arrives, and renders the ordered-evidence report (ADR-0002).
 *
 * BYO-key (ADR-0006): provider creds come from the environment
 * (OLLAMA_ / OPENAI_ vars), never hard-bound here. The harness investigates
 * READ-ONLY.
 *
 * LIVE (ADR-0007/0010): the supervisor yields CanonicalEvents as they happen; this
 * command appends each to the session AND prints a one-line timeline entry, then
 * renders the synthesized report once the terminal `report` event arrives. The
 * ~/.prismalens workspace stays as the durable record.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	CanonicalEvent,
	Hypothesis,
	InvestigationReport,
	NextStep,
	RuledOut,
} from "@prismalens/contracts";
import { investigateIncidentStream } from "@prismalens/engine";
import { defineCommand } from "citty";
import consola from "consola";
import { loadConfig } from "../config/loader.js";
import { resolveRepoSlug } from "../core/detect-repo.js";
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

		let resolved: ResolvedInvestigation;
		try {
			resolved = resolveInvestigation(
				{
					...(piped ? { alert: piped } : {}),
					...(args.query ? { query: args.query } : {}),
					...(args.repo ? { repo: args.repo } : {}),
					...(args.harness ? { harness: args.harness } : {}),
					...(args.service ? { service: args.service } : {}),
				},
				config,
			);
		} catch (err) {
			consola.error(err instanceof Error ? err.message : String(err));
			process.exitCode = 1;
			return;
		}
		const { context, harness, synth, harnessName } = resolved;
		const primaryAlert = context.alerts[0];

		if (!synth.apiKey) {
			consola.warn(
				"No OLLAMA_API_KEY / OPENAI_API_KEY in the environment — the synthesis call will likely fail (BYO-key, ADR-0006).",
			);
		}

		// (2) Create the run workspace + session under workspace.base_dir.
		const runId = randomUUID();
		const sessions = createSessionManager(config.workspace.base_dir);
		const session = await sessions.create({
			runId,
			alertname: primaryAlert.alertname,
			agent: harnessName,
			...(repoSlug ? { repo: repoSlug } : {}),
		});

		info(
			`Investigating "${primaryAlert.alertname}" with ${harnessName} in ${cwd} (run ${runId})`,
		);

		// (3) Drive the supervisor LIVE: append each canonical event to the session
		// as it arrives and print a one-line timeline entry; capture the terminal
		// `report` event for the renderer below.
		let report: InvestigationReport | null = null;
		let lastErrorMessage: string | undefined;
		try {
			for await (const event of investigateIncidentStream({
				context,
				harness,
				synth,
				runId,
			})) {
				await sessions.appendEvent(runId, event);
				if (event.kind === "report") {
					report = event.report;
				} else {
					if (event.kind === "error") lastErrorMessage = event.message;
					const entry = liveTimelineEntry(event);
					if (entry) line(entry);
				}
			}
		} catch (err) {
			await sessions.update(runId, { status: "errored" });
			consola.error(
				`Investigation failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exitCode = 1;
			return;
		}

		// No-report failure path: a branch that gathered no evidence and errored
		// emits no `report` event — surface the transport failure rather than a
		// fabricated RCA (mirrors the engine's no-evidence guard).
		if (!report) {
			await sessions.update(runId, { status: "errored" });
			consola.error(
				`Investigation produced no evidence — the harness branch failed: ${
					lastErrorMessage ?? "no evidence gathered"
				}`,
			);
			process.exitCode = 1;
			return;
		}

		// Persist the report + mark the session done.
		await sessions.writeReport(runId, report);
		await sessions.update(runId, {
			status: "done",
			completedAt: new Date().toISOString(),
		});

		// (4) Output. --output writes report JSON to a file; --json prints it to
		// stdout; otherwise render the ordered-evidence report for humans.
		if (args.output) {
			const outPath = resolve(args.output);
			await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
			success(`Report written to ${outPath}`);
		}

		if (json) {
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
			return;
		}

		if (!quiet) {
			renderReport(report);
			success(`Report saved to ${join(session.workspacePath, "report.json")}`);
		}
	},
});

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
