/**
 * Live smoke test — validates the adapter + runner against REAL deepagents
 * `streamEvents(v2)` output, driven by an Ollama Cloud model through its
 * OpenAI-compatible endpoint (Path A: `ChatOpenAI` @ https://ollama.com/v1).
 *
 * Gated: skips unless an API key is present. Run with the engine .env loaded:
 *
 *   set -a && . packages/@prismalens/engine/.env && set +a \
 *     && pnpm --filter @prismalens/engine test
 *
 * Env:
 *   OLLAMA_API_KEY (or OPENAI_API_KEY) — Ollama Cloud key (Bearer)
 *   OLLAMA_MODEL                       — e.g. gpt-oss:120b-cloud ('-cloud' stripped for the cloud API)
 *   OLLAMA_BASE_URL (optional)         — defaults to https://ollama.com/v1
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { CanonicalEventSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HarnessStreamEvent } from "../adapter/deepagents-adapter.js";
import { createDeepAgentsHarness } from "./deepagents-harness.js";
import { runBranch } from "./run-branch.js";

const KEY = process.env.OLLAMA_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";
// The '-cloud' suffix is the local-ollama convention; the cloud API wants the plain tag.
const MODEL = (process.env.OLLAMA_MODEL ?? "gpt-oss:120b").replace(/-cloud$/, "");
const hasKey = Boolean(KEY);

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const e of gen) out.push(e);
	return out;
}

describe("Ollama Cloud live smoke (deepagents streamEvents → canonical)", () => {
	it.skipIf(!hasKey)(
		"produces schema-valid canonical events from a real run",
		async () => {
			const model = new ChatOpenAI({
				apiKey: KEY,
				model: MODEL,
				temperature: 0,
				configuration: { baseURL: BASE_URL },
			});

			const getPods = new DynamicStructuredTool({
				name: "get_pods",
				description:
					"List Kubernetes pods and their status in a namespace (read-only).",
				schema: z.object({
					namespace: z.string().describe("the kubernetes namespace"),
				}),
				func: async ({ namespace }) =>
					`NAME       STATUS\napi-7d9f   CrashLoopBackOff\ndb-0       Running\n(namespace=${namespace})`,
			});

			const agent = createDeepAgentsHarness({
				model,
				tools: [getPods],
				systemPrompt:
					"You are an SRE assistant. Use the read-only get_pods tool to investigate, then briefly summarise what you found.",
			});

			const ctx = {
				runId: "11111111-1111-1111-1111-111111111111",
				branchId: "root",
			};
			const input = {
				messages: [
					{
						role: "user" as const,
						content:
							"The 'api' service is failing in namespace 'prod'. Check the pods and tell me what's wrong.",
					},
				],
			};

			const events = agent.streamEvents(input, {
				version: "v2",
			}) as AsyncIterable<HarnessStreamEvent>;
			const out = await collect(runBranch(events, ctx));

			// Every emitted event must validate against the canonical contract.
			for (const e of out) {
				const parsed = CanonicalEventSchema.safeParse(e);
				if (!parsed.success) {
					console.error("INVALID canonical event:", JSON.stringify(e));
					console.error(parsed.error.issues);
				}
				expect(parsed.success).toBe(true);
			}
			expect(out.some((e) => e.kind === "agent_step")).toBe(true);
			expect(out.at(-1)?.kind).toMatch(/branch_done|error/);

			console.log(
				`[smoke] ${out.length} canonical events: ${out.map((e) => e.kind).join(", ")}`,
			);
			console.log("[smoke] captured fixture:\n", JSON.stringify(out, null, 2));
		},
		180_000,
	);
});
