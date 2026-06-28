/**
 * Live smoke test — validates the adapter + runner against REAL deepagents
 * `streamEvents(v2)` output, driven by an Ollama model.
 *
 * Gated: skips unless OLLAMA_API_KEY and OLLAMA_MODEL are set. Run it with the
 * agents .env loaded, e.g.:
 *
 *   set -a && . packages/@prismalens/agents/.env && set +a \
 *     && pnpm --filter @prismalens/engine test -- run-branch ollama-smoke
 *
 * For Ollama Cloud: OLLAMA_API_KEY=<key> OLLAMA_MODEL=<cloud-model>
 *   (OLLAMA_BASE_URL defaults to https://ollama.com).
 * For local Ollama: OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=<pulled-model>
 *   (no key needed — set OLLAMA_API_KEY=local to satisfy the gate, or run unskipped).
 */
import { ChatOllama } from "@langchain/ollama";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { CanonicalEventSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HarnessStreamEvent } from "../adapter/deepagents-adapter.js";
import { createDeepAgentsHarness } from "./deepagents-harness.js";
import { runBranch } from "./run-branch.js";

const KEY = process.env.OLLAMA_API_KEY;
const MODEL = process.env.OLLAMA_MODEL;
const BASE_URL = process.env.OLLAMA_BASE_URL ?? "https://ollama.com";
const hasOllama = Boolean(KEY && MODEL);

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const e of gen) out.push(e);
	return out;
}

describe("Ollama live smoke (deepagents streamEvents → canonical)", () => {
	it.skipIf(!hasOllama)(
		"produces schema-valid canonical events from a real run",
		async () => {
			const model = new ChatOllama({
				baseUrl: BASE_URL,
				model: MODEL as string,
				// Ollama Cloud auth — harmless for a local instance that ignores it.
				headers: KEY ? { Authorization: `Bearer ${KEY}` } : undefined,
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
					"You are an SRE assistant. Use the read-only tools to investigate, then summarise what you found.",
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
				expect(CanonicalEventSchema.safeParse(e).success).toBe(true);
			}
			// We expect at least one model turn and a terminal event.
			expect(out.some((e) => e.kind === "agent_step")).toBe(true);
			expect(out.at(-1)?.kind).toMatch(/branch_done|error/);

			// Capture a fixture for offline adapter tests.
			console.log(
				`[ollama-smoke] ${out.length} canonical events:`,
				JSON.stringify(out, null, 2),
			);
		},
		120_000,
	);
});
