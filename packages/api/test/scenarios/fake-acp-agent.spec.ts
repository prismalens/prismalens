// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import { runInvestigation } from "@prismalens/engine";
import { afterAll, describe, expect, it } from "vitest";
import { installFakeAgent } from "../../../../scripts/fakes/fake-acp-agent.mjs";

const root = mkdtempSync(join(tmpdir(), "pl-fake-agent-"));
const binDir = mkdtempSync(join(root, "bin-"));
installFakeAgent(binDir, { session: "success" });
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function run(
	alertname: string,
	resume?: { sessionId: string; text: string },
): Promise<{ events: CanonicalEvent[]; sessionId: string }> {
	const events: CanonicalEvent[] = [];
	let sessionId = "";
	for await (const ev of runInvestigation({
		runId: "11111111-1111-4111-8111-111111111111",
		context: {
			alerts: [{ alertname, severity: "critical", labels: {}, annotations: {}, startsAt: null }],
			service: { name: "books" },
		},
		harness: "claude-code",
		descriptor: {
			...HARNESS_REGISTRY["claude-code"],
			binary: join(binDir, "claude-agent-acp"),
		},
		cwd: mkdtempSync(join(root, "clone-")),
		runDir: mkdtempSync(join(root, "run-")),
		initTimeoutMs: 10_000,
		promptTimeoutMs: 10_000,
		onSession: (s) => {
			sessionId = s.sessionId;
		},
		...(resume ? { resume: { ...resume, mode: "queue" as const, heads: [] } } : {}),
	})) {
		events.push(ev);
	}
	return { events, sessionId };
}

const toolResults = (events: CanonicalEvent[]) =>
	events.flatMap((e) => (e.kind === "tool_result" ? [e.result] : []));

describe("the fake ACP agent through the real engine", () => {
	it("Given the success session, Then the run streams a filled-in tool call and ends with a validated report", async () => {
		const { events } = await run("BooksSlow");
		const results = toolResults(events);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ ok: true, name: "`git log --oneline -5`" });
		const report = events.at(-1);
		if (report?.kind !== "report") throw new Error(`last event ${report?.kind}`);
		expect(report.report.rootCauseCategory).toBe("code");
		expect(report.report.fidelity?.harnessVersion).toBe("0.85.1-fake");
	});

	it("Given `fake-session:refusal` in the prompt, Then PrismaLens refuses the write and the run still reports", async () => {
		const { events } = await run("BooksSlow fake-session:refusal");
		expect(toolResults(events).map((r) => r.ok)).toEqual([false, true]);
		expect(events.at(-1)?.kind).toBe("report");
	});

	it("Given `fake-session:failure`, Then the run ends in an error naming the agent's exit", async () => {
		const { events } = await run("BooksSlow fake-session:failure");
		const last = events.at(-1);
		expect(last?.kind).toBe("error");
		expect(events.some((e) => e.kind === "report")).toBe(false);
	});

	it("Given a finished session, When a follow-up reopens it, Then the answer streams with no new report", async () => {
		const first = await run("BooksSlow");
		expect(first.sessionId).not.toBe("");
		const { events } = await run("BooksSlow", {
			sessionId: first.sessionId,
			text: "Was anything else deployed?",
		});
		expect(events.some((e) => e.kind === "report")).toBe(false);
		expect(JSON.stringify(events)).toContain("Was anything else deployed?");
		expect(events.at(-1)?.kind).toBe("branch_done");
	});

	it.skipIf(process.platform === "win32")(
		"Given a session file under a path with a space, Then the installed wrapper hands the whole path to the agent",
		() => {
			const spaced = join(root, "with space");
			mkdirSync(spaced);
			const session = join(spaced, "success.json");
			const here = dirname(fileURLToPath(import.meta.url));
			copyFileSync(join(here, "../../../../scripts/fakes/sessions/success.json"), session);
			const [bin] = installFakeAgent(mkdtempSync(join(root, "bin-")), { session, binaries: ["opencode"] });
			const out = spawnSync(bin, [], { input: "", encoding: "utf8", timeout: 10_000 });
			expect(out.stderr).not.toContain("no session");
			expect(out.status).toBe(0);
		},
	);
});
