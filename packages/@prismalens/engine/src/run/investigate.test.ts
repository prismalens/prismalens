// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalEvent, InvestigationContext } from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { conductRun } from "./conductor.js";
import { runInvestigation } from "./investigate.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "fake-acp-harness.mjs");

const context: InvestigationContext = {
	alerts: [{ alertname: "HighLatency", severity: "critical", labels: { service: "checkout" }, annotations: {} }],
	service: { name: "checkout" },
};

const dirs: string[] = [];
function tmp(name: string): string {
	const d = mkdtempSync(join(tmpdir(), `pl-${name}-`));
	dirs.push(d);
	return d;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function opts(mode: string, extra: Partial<Parameters<typeof runInvestigation>[0]> = {}) {
	const cwd = tmp("clone");
	const runDir = tmp("run");
	return {
		runId: "11111111-1111-4111-8111-111111111111",
		context,
		harness: "opencode" as const,
		descriptor: {
			binary: process.execPath,
			acpArgs: () => [FAKE],
			acpEnv: ({ configDir }: { configDir: string }) => ({ FAKE_MARKER: configDir }),
			configFiles: () => ({ "marker.json": "{}" }),
		},
		cwd,
		runDir,
		env: { ...process.env, FAKE_ACP_MODE: mode },
		initTimeoutMs: 10_000,
		promptTimeoutMs: 10_000,
		...extra,
	};
}

async function collect(mode: string, extra?: Partial<Parameters<typeof runInvestigation>[0]>) {
	const events: CanonicalEvent[] = [];
	const o = opts(mode, extra);
	for await (const ev of runInvestigation(o)) events.push(ev);
	return { events, ...o };
}

describe("runInvestigation over a fake ACP harness", () => {
	it("runs in the clone, refuses the write, validates the report first try, writes the transcript", async () => {
		const { events, cwd, runDir } = await collect("ok");
		const kinds = events.map((e) => e.kind);
		expect(kinds).toContain("tool_result");
		expect(kinds.at(-2)).toBe("branch_done");
		expect(kinds.at(-1)).toBe("report");
		const report = events.at(-1);
		if (report?.kind !== "report") throw new Error("no report");
		expect(report.report.summary).toContain(cwd);
		expect(report.report.fidelity?.harness).toBe("opencode");
		const results = events.filter((e) => e.kind === "tool_result");
		expect(results.map((r) => (r.kind === "tool_result" ? r.result.ok : null))).toEqual([true, false]);
		expect(existsSync(join(cwd, "PRISMALENS_SPIKE.txt"))).toBe(false);
		const decisions = readFileSync(join(runDir, "transcript.jsonl"), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { m: string })
			.map((e) => {
				try {
					return JSON.parse(e.m) as { permission?: unknown; allowed?: boolean; why?: string };
				} catch {
					return {};
				}
			})
			.filter((e) => e.permission !== undefined);
		expect(decisions.map((d) => d.allowed)).toEqual([true, false]);
		expect(decisions[1]?.why).toBe("shell command would mutate");
		expect(existsSync(join(runDir, "config", "marker.json"))).toBe(true);
	});

	it("retries once in the same session when the first report is invalid", async () => {
		const { events } = await collect("retry");
		expect(events.at(-1)?.kind).toBe("report");
		const steps = events.filter((e) => e.kind === "agent_step").map((e) => (e.kind === "agent_step" ? e.text : ""));
		expect(steps.join("\n")).toContain("Corrected.");
	});

	it("fails loud after the retry, with the validation detail", async () => {
		const { events } = await collect("never");
		const last = events.at(-1);
		expect(last?.kind).toBe("error");
		if (last?.kind === "error") expect(last.message).toMatch(/did not validate after one retry.*summary/);
	});

	it("fails when the harness exits mid-turn", async () => {
		const { events } = await collect("crash");
		const last = events.at(-1);
		expect(last?.kind).toBe("error");
		if (last?.kind === "error") expect(last.message).toContain("exited early");
	});

	it("refuses a report produced without any tool evidence", async () => {
		const { events } = await collect("nowrite");
		const last = events.at(-1);
		expect(last?.kind).toBe("error");
		if (last?.kind === "error") expect(last.message).toContain("no evidence");
	});

	it("conductRun classifies the outcome and drives both ports", async () => {
		const stored: CanonicalEvent[] = [];
		let finished = 0;
		const outcome = await conductRun(opts("ok"), {
			sink: () => {},
			store: {
				create: async () => {},
				append: async (e) => {
					stored.push(e);
				},
				finish: async () => {
					finished += 1;
				},
				fail: async () => {},
			},
		});
		expect(outcome.failureKind).toBe("none");
		expect(outcome.report?.hypotheses[0]?.statement).toBe("connection pool exhausted");
		expect(finished).toBe(1);
		expect(stored.at(-1)?.kind).toBe("report");
	});
});
