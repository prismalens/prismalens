// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Live ACP smoke — drives the REAL `deepagents --acp` binary against Ollama Cloud
 * and asserts the canonical stream comes out the far end. Gated on OLLAMA_API_KEY
 * so the default suite stays hermetic/offline.
 *
 * Run:
 *   set -a && . packages/@prismalens/engine/.env && set +a \
 *     && pnpm --filter @prismalens/engine test
 *
 * Env (from packages/@prismalens/engine/.env, gitignored):
 *   OLLAMA_API_KEY   — Ollama Cloud key (passed to the child as OPENAI_API_KEY)
 *   OLLAMA_MODEL     — e.g. gpt-oss:120b-cloud (the "-cloud" suffix is stripped for the API)
 *   OLLAMA_BASE_URL  — optional; defaults to https://ollama.com/v1
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { runDeepAgentsBranch } from "./acp-run-branch.js";

const KEY = process.env.OLLAMA_API_KEY;
const rawModel = process.env.OLLAMA_MODEL ?? "gpt-oss:120b";
const model = `openai:${rawModel.replace(/-cloud$/, "")}`;
const baseUrl = process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";

describe.skipIf(!KEY)("deepagents ACP live smoke", () => {
	it("streams canonical events from a real deepagents --acp run", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "acp-smoke-"));
		writeFileSync(
			join(cwd, "incident.md"),
			"# Incident\napi pod CrashLoopBackOff in prod\n",
		);

		const events: CanonicalEvent[] = [];
		for await (const ev of runDeepAgentsBranch(
			{
				cwd,
				prompt:
					"Run the shell command `ls -la` to inspect the workspace, then tell me in one sentence what files you found.",
				model,
				env: { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: baseUrl },
			},
			{ runId: "11111111-1111-1111-1111-111111111111", branchId: "root" },
		)) {
			events.push(ev);
		}

		// Always terminates with exactly one terminal event.
		const terminal = events.at(-1);
		expect(terminal?.kind === "branch_done" || terminal?.kind === "error").toBe(
			true,
		);
		if (terminal?.kind === "error") {
			throw new Error(`live ACP run errored: ${terminal.message}`);
		}
		// Produced real work: at least one agent step, and seqs are monotonic.
		expect(events.some((e) => e.kind === "agent_step")).toBe(true);
		expect(events.map((e) => e.seq)).toEqual([...events.map((_, i) => i)]);
	}, 200_000);
});
