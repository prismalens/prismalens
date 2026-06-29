/**
 * Live Claude Code Agent-SDK smoke — confirms the SDK authenticates (via the
 * logged-in CC session ~/.claude/.credentials.json or ANTHROPIC_API_KEY), spawns,
 * and that runClaudeCodeBranch yields a terminal canonical event. Gated so the
 * default suite stays hermetic.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { runClaudeCodeBranch } from "./claude-code-runner.js";

// OLLAMA_API_KEY (set by sourcing the engine .env) gates "live mode" so a plain
// `pnpm test` stays hermetic; CC additionally needs its own auth (the logged-in CC
// session creds or ANTHROPIC_API_KEY).
const enabled =
	Boolean(process.env.OLLAMA_API_KEY) &&
	(existsSync(join(homedir(), ".claude", ".credentials.json")) ||
		Boolean(process.env.ANTHROPIC_API_KEY));

describe.skipIf(!enabled)("claude code Agent SDK live smoke", () => {
	it("runs a trivial query and terminates with a canonical event", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "cc-smoke-"));
		const events: CanonicalEvent[] = [];
		for await (const ev of runClaudeCodeBranch(
			{
				cwd,
				prompt:
					"Reply with exactly the single word READY. Do not use any tools.",
				maxTurns: 3,
			},
			{ runId: "11111111-1111-1111-1111-111111111111", branchId: "root" },
		)) {
			events.push(ev);
		}
		const terminal = events.at(-1);
		console.log(
			`cc smoke: ${events.length} events; kinds=${JSON.stringify(events.map((e) => e.kind))}`,
		);
		if (terminal?.kind === "error") {
			throw new Error(`cc smoke errored: ${terminal.message}`);
		}
		expect(["branch_done", "report"]).toContain(terminal?.kind);
	}, 120_000);
});
