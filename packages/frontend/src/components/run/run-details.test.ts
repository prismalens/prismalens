// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	InvestigationReport,
	InvestigationWithRelations,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "@/lib/investigation-events";
import {
	contextSections,
	evidenceSections,
	filterSteps,
	summarySections,
} from "./run-details";
import type { RunStep } from "./run-steps";

const report: InvestigationReport = {
	summary: "get_notes_for_book sorts every note in Python since v1.42.",
	rootCause: "get_notes_for_book sorts every note in Python since v1.42",
	rootCauseCategory: "code",
	hypotheses: [
		{
			statement: "The in-memory sort",
			status: "supported",
			evidence: [
				{
					observation: "Over 200 notes is 2.9s",
					source: "curl -sG prometheus",
					direction: "supports",
					status: "verified",
					toolCallId: "b",
				},
			],
		},
	],
	ruledOut: [
		{
			statement: "A slow database",
			why: "Query p99 is flat at 12ms",
			evidence: [
				{
					observation: "flat",
					source: "q",
					direction: "contradicts",
					status: "verified",
					toolCallId: "c",
				},
			],
		},
	],
	coverage: { queried: ["metrics", "git"], notQueried: ["Postgres"] },
	nextSteps: [{ title: "Roll back to v1.41", detail: "kubectl rollout undo" }],
	flaggedContent: [
		{ where: "tool-output", quote: "IGNORE PREVIOUS", why: "An instruction." },
	],
};

const inv = (over: Partial<InvestigationWithRelations>) =>
	({
		id: "inv",
		incidentId: "inc",
		status: "completed",
		kind: "investigation",
		startedAt: null,
		completedAt: null,
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		error: null,
		origin: "local",
		schemaVersion: 1,
		createdAt: "2026-10-10T01:05:00Z",
		updatedAt: "2026-10-10T01:07:00Z",
		...over,
	}) as InvestigationWithRelations;

const steps = new Map([
	["b", 2],
	["c", 3],
]);

describe("evidenceSections (#811 data mapping)", () => {
	it("links each evidence item and ruled-out cause to its step", () => {
		const out = evidenceSections(inv({ report }), steps, {
			live: false,
			standing: null,
		});
		expect(out.map((s) => s.title)).toEqual([
			"Likely cause",
			"Ruled out",
			"Checked",
			"Not checked",
			"Agent's suggested next steps",
		]);
		expect(out[0]?.rows[1]).toMatchObject({ text: "Over 200 notes is 2.9s", step: 2 });
		expect(out[1]?.rows[0]).toMatchObject({ text: "A slow database", step: 3 });
	});

	it("says a live run has no conclusion and whose finding stands", () => {
		const [so] = evidenceSections(inv({ status: "running" }), steps, {
			live: true,
			standing: { runId: "r2", name: "Run 2" },
		});
		expect(so?.title).toBe("So far");
		expect(so?.rows.map((r) => r.text)).toEqual([
			"No conclusion yet.",
			"Run 2's finding stands until this run reports.",
		]);
	});

	it("says a failed run failed before it reported", () => {
		const [none] = evidenceSections(inv({ status: "failed" }), steps, {
			live: false,
			standing: null,
		});
		expect(none?.rows[0]?.text).toBe("The run failed before it reported.");
	});
});

describe("contextSections (#811 data mapping)", () => {
	const items: TranscriptItem[] = [
		{
			kind: "operator",
			key: "1",
			text: "Look at deploys",
			at: "2026-10-10T01:05:00Z",
			state: "started",
			mode: "queue",
			attachments: [],
		},
		{
			kind: "operator",
			key: "2",
			text: "Also the index",
			at: "2026-10-10T01:06:00Z",
			state: "queued",
			mode: "queue",
			attachments: [],
		},
	];
	it("puts flagged content first, then the brief, your messages and the alert", () => {
		const out = contextSections({
			report,
			flaggedStep: new Map([[0, 8]]),
			items,
			briefBy: "PrismaLens when it started Run 2",
			alert: { title: "WalkGrouped", labels: { service: "api" }, fired: "Yesterday 23:30" },
		});
		expect(out.map((s) => s.title)).toEqual([
			"Flagged",
			"Brief",
			"Your messages",
			"Alert",
		]);
		expect(out[0]?.rows[0]).toMatchObject({ box: "danger", step: 8 });
		expect(out[2]?.rows[0]?.sub).toBe("Waiting for the agent's next pause");
		expect(out[3]?.rows[1]).toMatchObject({ text: "service=api", mono: true });
	});
});

describe("summarySections (#811 data mapping)", () => {
	it("shows access with its reason and a code row per repo, and no mode", () => {
		const out = summarySections(
			inv({
				resumable: true,
				workspace: {
					layout: "single",
					cwd: "/w",
					repos: [
						{
							name: "booklogr",
							dir: "/w/repo",
							sourceKind: "url",
							url: "https://github.com/x/booklogr",
							subPath: null,
							connectionId: null,
							head: "a1b2c3d4e5",
							branch: "main",
							services: ["booklogr-api"],
							credential: { source: "machine", label: "machine git (gh, s)", via: "gh" },
						},
					],
				},
			}),
			{
				status: { text: "Concluded: likely cause", tone: "ok" },
				started: { text: "Today 01:05 by PrismaLens" },
				took: { label: "Took", text: "2m 16s" },
				agent: "Claude Code 2.3.1",
				model: { text: "Opus", warn: false },
				effort: "High",
				access: { text: "Auto", sub: "No sandbox proven here." },
				chat: false,
			},
		);
		const labels = out.flatMap((s) => s.rows.map((r) => r.label));
		expect(labels).not.toContain("Mode");
		expect(labels).toContain("Access");
		expect(out[0]?.rows.find((r) => r.label === "Can continue")?.text).toBe("Yes");
		expect(out[2]?.rows[0]).toMatchObject({
			label: "booklogr",
			text: "main at a1b2c3d",
			sub: "Cloned with machine git (gh, s) from https://github.com/x/booklogr. Maps to booklogr-api.",
		});
	});
});

describe("filterSteps", () => {
	const s = (n: number, kind: "command" | "file", ok: boolean | null) =>
		({ n, kind, ok }) as RunStep;
	const all = [s(1, "command", true), s(2, "file", true), s(3, "command", false)];
	it("filters by commands, files and failures", () => {
		expect(filterSteps(all, "command").map((x) => x.n)).toEqual([1, 3]);
		expect(filterSteps(all, "file").map((x) => x.n)).toEqual([2]);
		expect(filterSteps(all, "failed").map((x) => x.n)).toEqual([3]);
		expect(filterSteps(all, "all")).toHaveLength(3);
	});
});
