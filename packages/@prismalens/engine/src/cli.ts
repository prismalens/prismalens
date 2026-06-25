// Dev CLI for the engine — a thin wrapper over the library. Runs ONE investigation,
// printing live StepEvents then the report. The library (index.ts) is the real product.
//
//   pnpm --filter @prismalens/engine investigate "pods crashlooping in ns prod"
//   pnpm --filter @prismalens/engine investigate --provider openai --base-url http://localhost:11434/v1 --model qwen2.5 "..."

import "dotenv/config";
import type { LLMProviderId } from "@prismalens/config/llm";
import { defaultTools } from "./index.js";
import { investigate } from "./loop.js";
import { createBackend } from "./providers.js";
import { loadAllowlist } from "./tools/shell-exec.js";
import type { Report, StepEvent } from "./types.js";

interface Args {
	incident: string;
	provider: LLMProviderId;
	model?: string;
	baseUrl?: string;
	maxSteps?: number;
	allowlist: string;
}

function parseArgs(argv: string[]): Args {
	const positional: string[] = [];
	let provider = "google" as LLMProviderId;
	let model: string | undefined;
	let baseUrl: string | undefined;
	let maxSteps: number | undefined;
	let allowlist = process.env.PRISMALENS_ALLOWLIST_FILE || "allowlist.example.json";
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];
		if (tok === "--provider") provider = (argv[++i] ?? "google") as LLMProviderId;
		else if (tok === "--model") model = argv[++i];
		else if (tok === "--base-url") baseUrl = argv[++i];
		else if (tok === "--max-steps") maxSteps = Number(argv[++i]);
		else if (tok === "--allowlist") allowlist = argv[++i] ?? allowlist;
		else if (tok !== undefined && !tok.startsWith("--")) positional.push(tok);
	}
	return { incident: positional.join(" ").trim(), provider, model, baseUrl, maxSteps, allowlist };
}

const printEvent = (e: StepEvent): void => {
	if (e.kind === "model_turn") {
		if (e.text) console.log(`\n[step ${e.step}] 🧠 ${e.text}`);
		for (const tc of e.toolCalls) console.log(`[step ${e.step}] → ${tc.name}(${JSON.stringify(tc.args)})`);
	} else if (e.kind === "tool_result") {
		console.log(`[step ${e.step}] ${e.ok ? "✓" : "✗"} ${e.preview.replace(/\n/g, "\n     ")}`);
	} else if (e.kind === "done") {
		console.log(`\n— investigation ended (${e.reason}) —`);
	}
};

function printReport(r: Report): void {
	console.log("\n══════════════════ REPORT ══════════════════");
	console.log(`\nSummary: ${r.summary}`);
	console.log(`Root cause: ${r.rootCause ?? "(undetermined)"}`);
	console.log("\nHypotheses (ordered, most likely first):");
	if (r.hypotheses.length === 0) console.log("  (none)");
	for (const h of r.hypotheses) {
		console.log(`\n  #${h.rank} ${h.statement}`);
		for (const ev of h.evidence) {
			const mark = ev.direction === "supports" ? "+" : "−";
			console.log(`     ${mark} [${ev.status}] ${ev.observation}  (src: ${ev.source})`);
		}
	}
	if (r.recommendations.length) {
		console.log("\nRecommendations:");
		for (const rec of r.recommendations) console.log(`  • ${rec.title}: ${rec.detail}`);
	}
	console.log("\n═════════════════════════════════════════════");
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.incident) {
		console.error('Usage: investigate [--provider <id>] [--model M] [--base-url URL] [--max-steps N] "<incident>"');
		process.exitCode = 2;
		return;
	}
	const model = args.model || process.env.PRISMALENS_LLM_MODEL || (args.provider === "google" ? "gemini-2.5-flash" : "");
	if (!model) {
		console.error(`Provide --model for provider "${args.provider}".`);
		process.exitCode = 2;
		return;
	}
	const backend = createBackend({ provider: args.provider, model, baseUrl: args.baseUrl });
	const allowlist = loadAllowlist(args.allowlist);
	const tools = defaultTools(allowlist);
	console.log(`Investigating with ${backend.id}; allowlist: ${Object.keys(allowlist.commands).join(", ")}`);
	let report: Report = { summary: "", rootCause: null, hypotheses: [], recommendations: [] };
	for await (const ev of investigate({ backend, tools, incident: args.incident, maxSteps: args.maxSteps })) {
		printEvent(ev);
		if (ev.kind === "report") report = ev.report;
	}
	printReport(report);
}

main().catch((err: unknown) => {
	console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
});
