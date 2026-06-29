/**
 * `prismalens investigate` — the core investigation command (ADR-0008/0010).
 *
 * Seeds a read-only root-cause investigation from a firing alert (piped on stdin
 * as a FiringAlert JSON, or synthesized from `--query`), rents a Tier-2 harness
 * (deepagents over ACP, or Claude Code over the Agent SDK), drives the Tier-1
 * supervisor (`investigateIncident`), persists the run, and renders the
 * ordered-evidence report (ADR-0002).
 *
 * BYO-key (ADR-0006): provider creds come from the environment
 * (OLLAMA_ / OPENAI_ vars), never hard-bound here. The harness investigates
 * READ-ONLY.
 *
 * FIRST CUT: `investigateIncident` AWAITS the whole run, then returns
 * `{ report, events }` in one shot — so this command shows progress around the
 * await rather than streaming. A streaming variant (the supervisor yielding
 * CanonicalEvents live, for the visual UI in ADR-0007) is a follow-up.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	Hypothesis,
	InvestigationReport,
	NextStep,
	RuledOut,
} from "@prismalens/contracts";
import {
	claudeCodeHarness,
	deepAgentsHarness,
	type FiringAlert,
	type HarnessRunner,
	investigateIncident,
} from "@prismalens/engine";
import { defineCommand } from "citty";
import consola from "consola";
import { loadConfig } from "../config/loader.js";
import { detectRepo } from "../core/detect-repo.js";
import { parseStdin } from "../core/parse-stdin.js";
import { createSessionManager } from "../core/session.js";

const DEFAULT_PROMETHEUS_URL = "http://localhost:9090";
const DEFAULT_ALERTMANAGER_URL = "http://localhost:9093";
const DEFAULT_API_URL = "http://localhost:5000";
const DEFAULT_OPENAI_BASE_URL = "https://ollama.com/v1";
const DEFAULT_SYNTH_MODEL = "gpt-oss:120b";

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
		runtime: {
			type: "enum",
			options: ["process", "tmux"],
			description:
				"Execution runtime. Only 'process' (the in-process engine) is supported in this build.",
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

		// (1) Resolve the seed alert: piped FiringAlert JSON wins, else --query.
		const piped = await parseStdin();
		let alert: FiringAlert;
		if (piped) {
			alert = coerceFiringAlert(piped);
		} else if (args.query) {
			alert = synthesizeAlert(args.query);
		} else {
			consola.error(
				'No alert to investigate. Pipe a FiringAlert JSON on stdin, or pass --query/-q "<alert summary>".',
			);
			process.exitCode = 1;
			return;
		}

		// (2) cwd = --repo (a local repo path) else the current directory. NOTE:
		// detectRepo() returns an OWNER/REPO slug (not a path), so it can't serve as
		// a cwd — it's used below to label the session, not to choose the directory.
		const cwd = args.repo ? resolve(args.repo) : process.cwd();
		const repoSlug = await detectRepo(cwd);

		// Load + merge config (global → project → CLI overrides); --model overrides agent.model.
		const config = await loadConfig({
			...(args.config ? { configPath: args.config } : {}),
			cwd,
			cliOverrides: { ...(args.model ? { model: args.model } : {}) },
		});

		if (args.runtime && args.runtime !== "process") {
			consola.warn(
				`runtime "${args.runtime}" is not supported in this build; using the in-process engine.`,
			);
		}

		// (3) Telemetry surfaces (read-only) — config with host-local fallbacks.
		const telemetry = {
			prometheusUrl: config.telemetry.prometheusUrl ?? DEFAULT_PROMETHEUS_URL,
			alertmanagerUrl:
				config.telemetry.alertmanagerUrl ?? DEFAULT_ALERTMANAGER_URL,
			apiUrl: config.telemetry.apiUrl ?? DEFAULT_API_URL,
		};

		// (4) Build the Tier-2 harness from --harness (else agent.default).
		const harnessName = args.harness ?? config.agent.default;
		let harness: HarnessRunner;
		switch (harnessName) {
			case "deepagents":
				harness = deepAgentsHarness({
					cwd,
					// agent.model is a bare id here; deepagents wants a provider prefix.
					...(config.agent.model
						? { model: `openai:${config.agent.model}` }
						: {}),
					env: {
						OPENAI_API_KEY:
							process.env.OLLAMA_API_KEY ?? process.env.OPENAI_API_KEY,
						OPENAI_BASE_URL:
							process.env.OLLAMA_BASE_URL ??
							process.env.OPENAI_BASE_URL ??
							DEFAULT_OPENAI_BASE_URL,
					},
				});
				break;
			case "claude-code":
				harness = claudeCodeHarness({
					cwd,
					...(config.agent.model ? { model: config.agent.model } : {}),
				});
				break;
			case "codex":
				consola.error("The 'codex' harness is not implemented yet.");
				process.exitCode = 1;
				return;
			default:
				// citty's enum arg widens to `string`, so this also catches an
				// unknown --harness value.
				consola.error(`Unknown harness: ${harnessName}`);
				process.exitCode = 1;
				return;
		}

		// (5) Tier-1 reduce model (Vercel AI SDK, OpenAI-compatible, BYO-key).
		const synth = {
			baseURL:
				process.env.OLLAMA_BASE_URL ??
				process.env.OPENAI_BASE_URL ??
				DEFAULT_OPENAI_BASE_URL,
			apiKey: process.env.OLLAMA_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
			model: config.agent.model ?? DEFAULT_SYNTH_MODEL,
		};
		if (!synth.apiKey) {
			consola.warn(
				"No OLLAMA_API_KEY / OPENAI_API_KEY in the environment — the synthesis call will likely fail (BYO-key, ADR-0006).",
			);
		}

		// (6) Create the run workspace + session under workspace.base_dir.
		const runId = randomUUID();
		const sessions = createSessionManager(config.workspace.base_dir);
		const session = await sessions.create({
			runId,
			alertname: alert.alertname,
			agent: harnessName,
			...(repoSlug ? { repo: repoSlug } : {}),
		});

		info(
			`Investigating "${alert.alertname}" with ${harnessName} in ${cwd} (run ${runId})`,
		);

		// (7) Drive the supervisor. First cut: this AWAITS the whole run, then
		// returns { report, events }. Streaming (yield-as-you-go) is a follow-up.
		let report: InvestigationReport;
		try {
			const result = await investigateIncident({
				alert,
				telemetry,
				harness,
				synth,
				runId,
			});
			report = result.report;

			// (8) Persist the canonical stream + report; mark the session done.
			for (const event of result.events) {
				await sessions.appendEvent(runId, event);
			}
			await sessions.writeReport(runId, report);
			await sessions.update(runId, {
				status: "done",
				completedAt: new Date().toISOString(),
			});
		} catch (err) {
			await sessions.update(runId, { status: "errored" });
			consola.error(
				`Investigation failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exitCode = 1;
			return;
		}

		// (9) Output. --output writes report JSON to a file; --json prints it to
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
// Alert coercion
// ---------------------------------------------------------------------------

/** Synthesize a minimal FiringAlert from a free-text `--query`. */
function synthesizeAlert(query: string): FiringAlert {
	return {
		alertname: query,
		severity: "unknown",
		labels: {},
		annotations: {},
		startsAt: null,
	};
}

/**
 * Coerce a piped JSON payload (a FiringAlert, or a webhook/Alertmanager-shaped
 * alert) into a FiringAlert. Permissive: pulls alertname/severity from top-level
 * fields, falling back to `labels`.
 */
function coerceFiringAlert(raw: Record<string, unknown>): FiringAlert {
	const labels = asStringMap(raw.labels);
	const annotations = asStringMap(raw.annotations);
	const alertname =
		(typeof raw.alertname === "string" && raw.alertname) ||
		labels.alertname ||
		"unknown";
	const severity =
		typeof raw.severity === "string"
			? raw.severity
			: typeof labels.severity === "string"
				? labels.severity
				: null;
	const startsAt = typeof raw.startsAt === "string" ? raw.startsAt : null;
	return { alertname, severity, labels, annotations, startsAt };
}

function asStringMap(x: unknown): Record<string, string> {
	if (x === null || typeof x !== "object") return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(x)) {
		if (typeof v === "string") out[k] = v;
	}
	return out;
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
