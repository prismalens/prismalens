// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	composeRestartMessage,
	lastActivityOf,
	notResumedReason,
	type RecoveryInput,
	type RestartFacts,
	span,
} from "./restart-recovery.js";

const NOW = new Date("2026-10-28T09:14:00Z");
const min = 60_000;

const input = (over: Partial<RecoveryInput> = {}): RecoveryInput => ({
	enabled: true,
	now: NOW,
	lastActivityAt: new Date(NOW.getTime() - 22 * min),
	attempt: 1,
	bootLoop: false,
	contained: true,
	agent: "Codex",
	preflight: null,
	...over,
});

describe("notResumedReason (#981)", () => {
	it("resumes a run cut off minutes ago", () => {
		expect(notResumedReason(input())).toBeNull();
	});

	it("names each reason a run is left for the operator", () => {
		expect(notResumedReason(input({ enabled: false }))).toBe(
			"Resume after a restart is off in Settings.",
		);
		expect(notResumedReason(input({ contained: false }))).toMatch(
			/^Codex from before the restart may still be running/,
		);
		expect(notResumedReason(input({ bootLoop: true }))).toMatch(/within 2 minutes/);
		expect(notResumedReason(input({ attempt: 3 }))).toBeNull();
		expect(notResumedReason(input({ attempt: 4 }))).toBe(
			"PrismaLens stopped again during each of the last 3 resumes of this run, so it stopped trying.",
		);
		expect(
			notResumedReason(
				input({ lastActivityAt: new Date(NOW.getTime() - 50 * 60 * min) }),
			),
		).toMatch(/^PrismaLens was off for 2 days, and a run resumes on its own only within a day/);
		expect(notResumedReason(input({ preflight: "Codex isn't signed in." }))).toBe(
			"Codex isn't signed in.",
		);
	});

	it("an agent that may still be running wins over every other reason: a second one is never started", () => {
		expect(
			notResumedReason(input({ contained: false, attempt: 9, preflight: "x" })),
		).toMatch(/may still be running/);
	});
});

describe("lastActivityOf (#981 OBJ-006)", () => {
	it("ignores what a boot wrote, so an earlier failed boot never moves the run's last activity", () => {
		const at = (m: number) => new Date(NOW.getTime() - m * min);
		const rows = [
			{ createdAt: at(30), event: JSON.stringify({ kind: "agent_step", text: "x" }) },
			{ createdAt: at(5), event: JSON.stringify({ kind: "permission_answer", outcome: "restarted" }) },
			{ createdAt: at(4), event: JSON.stringify({ kind: "operator_message", delivered: false }) },
		];
		expect(lastActivityOf(rows, NOW)).toEqual(at(30));
		expect(lastActivityOf([], NOW)).toEqual(NOW);
	});
});

describe("span", () => {
	it("reads in minutes, hours or days", () => {
		expect(span(22 * min)).toBe("22 minutes");
		expect(span(1 * min)).toBe("1 minute");
		expect(span(5 * 60 * min)).toBe("5 hours");
		expect(span(63 * 60 * min)).toBe("3 days");
	});
});

const facts = (over: Partial<RestartFacts> = {}): RestartFacts => ({
	stoppedAt: new Date("2026-10-28T08:52:00Z"),
	resumedAt: NOW,
	timeZone: "UTC",
	turn: "report",
	alerts: { catchUp: "done", fired: [], resolved: [] },
	deniedAsks: [],
	workspace: [{ repo: null, state: "as-was", head: "4f1c2ab9d0" }],
	snapshot: "available",
	...over,
});

describe("composeRestartMessage (#981)", () => {
	it("names the gap, the uncertain last command, the workspace and the next step", () => {
		expect(composeRestartMessage(facts())).toBe(
			"PrismaLens stopped at 28 Oct, 08:52 and started again at 28 Oct, 09:14 (times UTC), 22 minutes later. Your last command may or may not have completed: check before relying on its effect. Your workspace is at commit 4f1c2ab, as it was. Continue the investigation from your last step.",
		);
	});

	it("lists alerts that fired and resolved during the gap, and says when it couldn't check (OBJ-008)", () => {
		const text = composeRestartMessage(
			facts({
				alerts: {
					catchUp: "unchecked",
					fired: [{ title: "CheckoutLatencyHigh", at: new Date("2026-10-28T09:03:00Z") }],
					resolved: [{ title: "DiskPressure", at: new Date("2026-10-28T09:05:00Z") }],
				},
			}),
		);
		expect(text).toContain(
			"While PrismaLens was stopped, 1 alert fired on this incident: CheckoutLatencyHigh at 28 Oct, 09:03; and 1 alert resolved: DiskPressure at 28 Oct, 09:05.",
		);
		expect(text).toContain("couldn't check its alert sources");
	});

	it("caps a long alert list", () => {
		const fired = Array.from({ length: 7 }, (_, i) => ({
			title: `A${i}`,
			at: new Date("2026-10-28T09:00:00Z"),
		}));
		expect(
			composeRestartMessage(facts({ alerts: { catchUp: "done", fired, resolved: [] } })),
		).toContain("A4 at 28 Oct, 09:00 and 2 more.");
	});

	it("says only what git showed about the workspace (OBJ-011)", () => {
		const text = composeRestartMessage(
			facts({
				workspace: [
					{ repo: "api", state: "changed", head: "4f1c2ab9", changed: 3 },
					{ repo: "web", state: "moved", head: "aaaaaaa1", recorded: "bbbbbbb2" },
					{ repo: "infra", state: "rebuilt", head: "ccccccc3" },
				],
				snapshot: "unavailable",
			}),
		);
		expect(text).toContain(
			"Your workspace for api is at commit 4f1c2ab with 3 changed files (git status), which may include your edits from before the stop.",
		);
		expect(text).toContain("Your workspace for web is at commit aaaaaaa, not bbbbbbb as recorded.");
		expect(text).toContain("changes you made to its files before the stop are gone.");
		expect(text).toContain("The pre-run evidence snapshot is unavailable.");
	});

	it("an interrupted answer is told the question, and a denied ask may be asked again", () => {
		const text = composeRestartMessage(
			facts({ turn: "answer", question: "why did p99 jump?", deniedAsks: ["run kubectl rollout restart"] }),
		);
		expect(text).toContain(
			"Your request to run kubectl rollout restart was closed unanswered because PrismaLens stopped; ask again if you still need it.",
		);
		expect(text.endsWith('You were answering: "why did p99 jump?". Answer it.')).toBe(true);
	});
});

describe("observeWorkspace (#981 OBJ-011)", () => {
	it("tells a kept, changed, moved and rebuilt workspace apart from what git shows", async () => {
		const { observeWorkspace } = await import("./investigation-run.js");
		const H = "4f1c2ab9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f";
		const git = (dir: string, args: string[]) =>
			args[0] === "rev-parse"
				? `${dir === "/moved" ? "aaaaaaa1111111111111111111111111111111111" : H}\n`
				: dir === "/changed"
					? " M src/pool.ts\n?? notes.md\n"
					: "";
		const repos = ["/kept", "/changed", "/moved", "/gone"].map((dir) => ({ name: dir.slice(1), dir, head: H }));
		const existed = new Map([["/kept", true], ["/changed", true], ["/moved", true], ["/gone", false]]);
		expect(observeWorkspace(repos, existed, git)).toEqual([
			{ repo: "kept", state: "as-was", head: H },
			{ repo: "changed", state: "changed", head: H, changed: 2 },
			{ repo: "moved", state: "moved", head: "aaaaaaa1111111111111111111111111111111111", recorded: H },
			{ repo: "gone", state: "rebuilt", head: H },
		]);
		expect(observeWorkspace([repos[0] as (typeof repos)[0]], existed, git)).toEqual([{ repo: null, state: "as-was", head: H }]);
	});
});
