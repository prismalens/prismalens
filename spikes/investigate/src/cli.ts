// CLI entry for the M1 spike. Runs ONE investigation end-to-end, in-process, no
// worker/Redis/API/DB. Prints live step telemetry, then the final report.
//
//   pnpm investigate "pods in ns prod are crashlooping since 14:00"
//   pnpm investigate --backend ollama --model qwen2.5 "checkout latency spiked"

import "dotenv/config";
import type { EventSink, ModelBackend, Report } from "./types.js";
import { createGeminiBackend } from "./backends/gemini.js";
import { createOllamaBackend } from "./backends/ollama.js";
import { createOpenAIBackend } from "./backends/openai.js";
import { investigate } from "./loop.js";
import { loadAllowlist } from "./tools/shell-exec.js";

interface Args {
	incident: string;
	backend: "gemini" | "ollama" | "openai";
	model?: string;
	maxSteps?: number;
	allowlist: string;
}

function parseArgs(argv: string[]): Args {
	const positional: string[] = [];
	let backend: "gemini" | "ollama" | "openai" = "gemini";
	let model: string | undefined;
	let maxSteps: number | undefined;
	let allowlist = process.env.SPIKE_ALLOWLIST_FILE || "allowlist.example.json";
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];
		if (tok === "--backend") {
			const b = argv[++i];
			backend = b === "ollama" ? "ollama" : b === "openai" ? "openai" : "gemini";
		}
		else if (tok === "--model") model = argv[++i];
		else if (tok === "--max-steps") maxSteps = Number(argv[++i]);
		else if (tok === "--allowlist") allowlist = argv[++i] ?? allowlist;
		else if (tok !== undefined && !tok.startsWith("--")) positional.push(tok);
	}
	return { incident: positional.join(" ").trim(), backend, model, maxSteps, allowlist };
}

function buildBackend(args: Args): ModelBackend {
	if (args.backend === "ollama") {
		return createOllamaBackend({
			host: process.env.OLLAMA_HOST || "http://localhost:11434",
			model: args.model || process.env.OLLAMA_MODEL || "qwen2.5",
		});
	}
	if (args.backend === "openai") {
		// Defaults to Gemini's OpenAI-compatibility endpoint with the SAME Gemini key —
		// proves the swappable seam at $0. Override OPENAI_BASE_URL / OPENAI_API_KEY /
		// OPENAI_MODEL to target real OpenAI, Groq, OpenRouter, etc.
		const baseUrl = process.env.OPENAI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
		const apiKey = process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY;
		if (!apiKey) {
			throw new Error(
				"No key for the OpenAI-compatible backend. Set OPENAI_API_KEY, or GOOGLE_API_KEY to use Gemini's OpenAI-compatible endpoint.",
			);
		}
		const model = args.model || process.env.OPENAI_MODEL || "gemini-2.5-flash";
		const backend = createOpenAIBackend({ baseUrl, apiKey, model });
		delete process.env.OPENAI_API_KEY;
		delete process.env.GOOGLE_API_KEY;
		return backend;
	}
	const apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		throw new Error(
			"GOOGLE_API_KEY is not set. Get a free key at https://aistudio.google.com and put it in spikes/investigate/.env (copy from .env.example). Never paste it on a command line or in chat.",
		);
	}
	const model = args.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
	const backend = createGeminiBackend({ apiKey, model });
	// The backend captured the key; drop it from process.env so binaries spawned by
	// shell_exec never inherit it (defense in depth alongside the tool's env scrub).
	delete process.env.GOOGLE_API_KEY;
	return backend;
}

const printEvent: EventSink = (e) => {
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
		console.error('Usage: pnpm investigate [--backend gemini|ollama] [--model M] [--max-steps N] "<incident description>"');
		process.exitCode = 2;
		return;
	}
	const backend = buildBackend(args);
	const allowlist = loadAllowlist(args.allowlist);
	console.log(`Investigating with ${backend.id}; allowlist: ${Object.keys(allowlist.commands).join(", ")}`);
	const report = await investigate({ backend, allowlist, incident: args.incident, maxSteps: args.maxSteps, onEvent: printEvent });
	printReport(report);
}

main().catch((err: unknown) => {
	console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
});
