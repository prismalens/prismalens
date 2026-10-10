// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { RunRef } from "@/components/incidents/record-context";
import {
	codeChip,
	dayClock,
	firingWord,
	runAge,
	runLabel,
	shortCredential,
	viewName,
} from "./run-labels";

const ref = (over: Partial<RunRef>): RunRef => ({
	id: "r",
	status: "completed",
	kind: "investigation",
	rootCause: null,
	createdAt: "2026-10-10T01:05:00Z",
	completedAt: "2026-10-10T01:07:16Z",
	...over,
});

const runs: RunRef[] = [
	ref({ id: "r3", status: "running", createdAt: "2026-10-10T12:17:00Z" }),
	ref({ id: "q", kind: "chat", title: "did v1.41 run the same query?" }),
	ref({ id: "r2", hasReport: true, rootCause: "sorts in Python" }),
	ref({ id: "r1", hasReport: true, createdAt: "2026-10-10T00:00:00Z" }),
];

describe("run labels (#811)", () => {
	it("names runs by number among investigations and chats alike, and asks by their question", () => {
		expect(runs.map((r) => runLabel(runs, r))).toEqual([
			"Run 4, investigating",
			"Ask: did v1.41 run the same query?",
			"Run 2, likely cause",
			"Run 1, no cause named",
		]);
		expect(viewName(runs, runs[1] as RunRef)).toBe("Ask");
		expect(viewName(runs, runs[2] as RunRef)).toBe("Run 2");
	});

	it("says failed and stopped runs so", () => {
		expect(runLabel(runs, ref({ id: "r1", status: "failed" }))).toBe(
			"Run 1, failed",
		);
		expect(runLabel(runs, ref({ id: "r1", status: "cancelled" }))).toBe(
			"Run 1, stopped",
		);
	});

	it("ages a live run as now, a finished one from its start", () => {
		const now = Date.parse("2026-10-10T12:17:30Z");
		expect(runAge(runs[0] as RunRef, now)).toBe("now");
		expect(runAge(runs[2] as RunRef, now)).toBe("11h ago");
	});

	it("reads today and yesterday by name", () => {
		const now = new Date(2026, 9, 10, 13, 0).getTime();
		expect(dayClock(new Date(2026, 9, 10, 1, 5), now)).toBe("Today 01:05");
		expect(dayClock(new Date(2026, 9, 9, 23, 30), now)).toBe("Yesterday 23:30");
	});
});

describe("the credential chip (operator ruling, #811)", () => {
	it("names the helper without the user, and keeps the full source for the hint", () => {
		const machine = {
			source: "machine" as const,
			label: "machine git (gh, sumit)",
			via: "gh auth git-credential",
		};
		expect(shortCredential(machine)).toBe("machine git (gh)");
		expect(
			codeChip({ repos: [{ name: "booklogr", credential: machine }] }),
		).toEqual({
			text: "Code: machine git (gh)",
			title: "Cloned with machine git (gh, sumit), via gh auth git-credential",
		});
	});

	it("reads a token and a public clone as they are, and nothing for a run from before", () => {
		const chip = codeChip({
			repos: [
				{
					name: "api",
					credential: {
						source: "connection",
						label: "token A",
						via: "git-host-token fp 1a2b3c4d",
					},
				},
				{
					name: "web",
					credential: { source: "none", label: "public", via: "none" },
				},
			],
		});
		expect(chip?.text).toBe("Code: token A, public");
		expect(chip?.title).toBe(
			"api: Cloned with token A, via git-host-token fp 1a2b3c4d; web: Cloned with public, via none",
		);
		expect(codeChip({ repos: [{ name: "x" }] })).toBeNull();
	});
});

describe("firingWord (#811)", () => {
	it("counts from the earliest firing alert, and says when none fire", () => {
		const now = Date.parse("2026-10-10T12:18:00Z");
		expect(
			firingWord(
				[
					{ status: "triggered", triggeredAt: "2026-10-09T23:30:00Z" },
					{ status: "resolved", triggeredAt: "2026-10-09T20:00:00Z" },
				],
				now,
			),
		).toEqual({ text: "Firing for 12h 48m", firing: true });
		expect(firingWord([{ status: "resolved" }], now)).toEqual({
			text: "Not firing",
			firing: false,
		});
		expect(firingWord([], now)).toBeNull();
	});
});
