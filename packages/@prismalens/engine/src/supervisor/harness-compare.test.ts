/**
 * Live harness depth comparison — runs the SAME firing incident + SAME prompt +
 * SAME Tier-1 reduce model through BOTH Tier-2 harnesses (deepagents/ACP vs Claude
 * Code/Agent SDK) and prints a side-by-side of investigation depth and RCA
 * correctness. Isolates the harness variable (ADR-0008 "depth = Agent-SDK harness").
 *
 * Gated on OLLAMA_API_KEY (deepagents + reduce) + the substrate + Claude Code auth
 * (~/.claude/.credentials.json or ANTHROPIC_API_KEY). Per-harness failures are
 * captured, not fatal, so one harness dying still yields the other's result.
 */
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type CanonicalEvent,
	type InvestigationReport,
	singleAlertContext,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { fetchFiringAlerts } from "./alert-source.js";
import {
	claudeCodeHarness,
	deepAgentsHarness,
	investigateIncident,
} from "./investigate.js";

const KEY = process.env.OLLAMA_API_KEY;
const rawModel = process.env.OLLAMA_MODEL ?? "gpt-oss:120b";
const MODEL = rawModel.replace(/-cloud$/, "");
const HARNESS_MODEL = `openai:${MODEL}`;
const BASE_URL = process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";
const SUBSTRATE =
	process.env.SREFORGE_SUBSTRATE ??
	"/home/sumit/sources/sreforge-workspace/sreforge/use-cases/booklogr/stacks/flask-compose/substrate/booklogr";
const CLAUDE_CREDS = join(homedir(), ".claude", ".credentials.json");

const TELEMETRY = {
	prometheusUrl: "http://localhost:9090",
	alertmanagerUrl: "http://localhost:9093",
	apiUrl: "http://localhost:5000",
};

const enabled =
	Boolean(KEY) &&
	existsSync(SUBSTRATE) &&
	(existsSync(CLAUDE_CREDS) || Boolean(process.env.ANTHROPIC_API_KEY));

type Row =
	| {
			name: string;
			ok: true;
			agentSteps: number;
			toolCalls: number;
			maxDepth: number;
			subagents: string[];
			category: string | null;
			rootCause: string | null;
			correct: boolean;
	  }
	| { name: string; ok: false; error: string };

function measure(
	name: string,
	events: CanonicalEvent[],
	report: InvestigationReport,
): Row {
	const toolCalls = events.filter((e) => e.kind === "tool_result").length;
	const agentSteps = events.filter((e) => e.kind === "agent_step").length;
	const maxDepth = events.reduce(
		(m, e) => Math.max(m, "path" in e ? e.path.length : 0),
		0,
	);
	const subagents = [
		...new Set(
			events.flatMap((e) => ("label" in e && e.label ? [e.label] : [])),
		),
	];
	const blob =
		`${report.summary} ${report.rootCause ?? ""} ${report.hypotheses[0]?.statement ?? ""}`.toLowerCase();
	return {
		name,
		ok: true,
		agentSteps,
		toolCalls,
		maxDepth,
		subagents,
		category: report.rootCauseCategory,
		rootCause: report.rootCause,
		correct: /cache|nullcache|stampede/.test(blob),
	};
}

describe.skipIf(!enabled)(
	"harness depth comparison — deepagents vs Claude Code",
	() => {
		it("runs both harnesses on the same incident and compares depth + correctness", async () => {
			const alerts = await fetchFiringAlerts(
				TELEMETRY.alertmanagerUrl,
				AbortSignal.timeout(5000),
			);
			expect(
				alerts.length,
				"no firing alert — run `pnpm forge arm booklogr` first",
			).toBeGreaterThan(0);
			const alert = alerts[0];
			const synth = {
				providerId: "ollama" as const,
				baseURL: BASE_URL,
				apiKey: KEY ?? "",
				model: MODEL,
			};

			const harnesses = [
				{
					name: "deepagents (ACP)",
					runner: deepAgentsHarness({
						cwd: SUBSTRATE,
						model: HARNESS_MODEL,
						env: { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: BASE_URL },
						promptTimeoutMs: 300_000,
						initTimeoutMs: 120_000,
					}),
				},
				{
					name: "claude-code (Agent SDK)",
					runner: claudeCodeHarness({ cwd: SUBSTRATE, maxTurns: 40 }),
				},
			];

			const results: Row[] = [];
			const reports: Record<string, InvestigationReport> = {};
			for (const h of harnesses) {
				console.log(`\n===== running ${h.name} =====`);
				try {
					const { report, events } = await investigateIncident({
						context: singleAlertContext(alert, TELEMETRY),
						harness: h.runner,
						synth,
					});
					reports[h.name] = report;
					const row = measure(h.name, events, report);
					results.push(row);
					console.log(
						`${h.name}: steps=${row.agentSteps} tools=${row.toolCalls} maxDepth=${row.maxDepth} subagents=[${row.subagents.join(", ")}] category=${row.category} correct=${row.correct}`,
					);
					console.log(`  rootCause: ${row.rootCause}`);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					results.push({ name: h.name, ok: false, error: msg });
					console.log(`${h.name}: FAILED — ${msg}`);
				}
			}

			console.log("\n================ HARNESS COMPARISON ================");
			for (const r of results) {
				if (r.ok) {
					console.log(
						`${r.name.padEnd(26)} steps=${r.agentSteps}  tools=${r.toolCalls}  depth=${r.maxDepth}  subagents=${r.subagents.length}  correct=${r.correct}  (${r.category})`,
					);
				} else {
					console.log(`${r.name.padEnd(26)} FAILED: ${r.error}`);
				}
			}
			console.log("===================================================\n");

			const out = join(homedir(), "ai-context", "harness-compare.json");
			writeFileSync(out, JSON.stringify({ alert, results, reports }, null, 2));
			console.log(`comparison written to ${out}\n`);

			expect(
				results.some((r) => r.ok),
				"both harnesses failed",
			).toBe(true);
		}, 600_000);
	},
);
