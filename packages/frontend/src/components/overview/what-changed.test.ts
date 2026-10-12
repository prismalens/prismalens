// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	IncidentChange,
	IncidentChanges,
	TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { RunRef } from "@/components/incidents/record-context";
import {
	changeDetail,
	changeName,
	changesProblem,
	mergeTimeline,
} from "./what-changed";

const change = (extra: Partial<IncidentChange>): IncidentChange => ({
	id: crypto.randomUUID(),
	kind: "deployment",
	at: "2026-10-10T23:12:00Z",
	title: "Sort notes in Python",
	sha: "3f9a2c1d00",
	tag: null,
	pr: null,
	author: null,
	files: null,
	url: null,
	repo: "booklogr/api",
	service: null,
	source: "git",
	...extra,
});

const entry = (
	extra: Partial<TimelineEntryWithRelations>,
): TimelineEntryWithRelations =>
	({
		id: crypto.randomUUID(),
		incidentId: "i",
		type: "custom",
		title: "x",
		description: null,
		metadata: null,
		source: "system",
		occurredAt: "2026-10-10T23:30:00Z",
		createdAt: "2026-10-10T23:30:00Z",
		user: null,
		...extra,
	}) as TimelineEntryWithRelations;

const run = (extra: Partial<RunRef>): RunRef =>
	({
		id: "r1",
		status: "completed",
		kind: "investigation",
		hasReport: true,
		rootCause: "Sorting in Python",
		createdAt: "2026-10-11T01:05:00Z",
		completedAt: "2026-10-11T01:07:00Z",
		...extra,
	}) as RunRef;

describe("changeName", () => {
	it("names a deploy by its tag, else its short sha", () => {
		expect(changeName(change({ tag: "v1.42" }))).toBe("Deploy v1.42");
		expect(changeName(change({}))).toBe("Deploy 3f9a2c1");
		expect(changeName(change({ kind: "merge", pr: 12 }))).toBe("Merged #12");
	});

	it("says how many files and the first", () => {
		expect(
			changeDetail(change({ files: { count: 2, paths: ["api/books.py"] } })),
		).toBe("2 files, including api/books.py");
		expect(changeDetail(change({}))).toBe("Sort notes in Python");
	});
});

describe("mergeTimeline", () => {
	it("merges entries and changes newest first, folding a run's own entries", () => {
		const runs = [run({})];
		const rows = mergeTimeline(
			[
				entry({ type: "incident_created", occurredAt: "2026-10-10T23:30:00Z" }),
				entry({
					type: "investigation_completed",
					metadata: { investigationId: "r1" },
					occurredAt: "2026-10-11T01:07:00Z",
				}),
				entry({
					type: "custom",
					title: "Tool ran",
					metadata: { investigationId: "r1" },
					occurredAt: "2026-10-11T01:06:00Z",
				}),
				entry({ type: "comment", title: "paged DBA", occurredAt: "2026-10-11T02:00:00Z" }),
			],
			[change({ tag: "v1.42" })],
			runs,
		);
		expect(rows.map((r) => r.text)).toEqual([
			"Note: paged DBA",
			"Run 1 concluded: likely cause",
			"Incident opened",
			"Deploy v1.42: Sort notes in Python",
		]);
		expect(rows[1]?.runId).toBe("r1");
	});

	describe("shows the reason the backend wrote (#673 w6-25, w6-26)", () => {
		const one = (e: Partial<TimelineEntryWithRelations>) =>
			mergeTimeline([entry(e)], [], [])[0];

		it("names the incident a refire follows and links to it", () => {
			const row = one({
				type: "incident_created",
				description: "New incident: WalkRefire fired again after INC-8 had its alerts cleared",
				metadata: { priorIncidentId: "inc-8" },
			});
			expect(row?.text).toBe(
				"New incident: WalkRefire fired again after INC-8 had its alerts cleared",
			);
			expect(row?.incidentId).toBe("inc-8");
		});

		it("says Incident opened when nothing came before", () => {
			const row = one({
				type: "incident_created",
				description: "Incident INC-9 was created",
			});
			expect(row?.text).toBe("Incident opened");
			expect(row?.incidentId).toBeUndefined();
		});

		it("says why an auto-run was skipped", () => {
			const row = one({
				type: "custom",
				title: "Auto-investigation skipped",
				description: "Investigation already in progress",
			});
			expect(row?.text).toBe(
				"Auto-investigation skipped: Investigation already in progress",
			);
		});

		it("does not repeat a reason its title already holds", () => {
			const row = one({
				type: "custom",
				title: "Auto-investigation skipped: the agent is not signed in",
				description: "the agent is not signed in",
			});
			expect(row?.text).toBe(
				"Auto-investigation skipped: the agent is not signed in",
			);
		});
	});
});

describe("changesProblem", () => {
	const changes = (extra: Partial<IncidentChanges>): IncidentChanges => ({
		incidentId: "i",
		startedAt: "2026-10-10T23:30:00Z",
		window: { start: "2026-10-10T00:00:00Z", end: "2026-10-11T00:00:00Z" },
		deploy: null,
		timeline: [],
		total: 0,
		state: "failed",
		refreshing: false,
		sources: [],
		...extra,
	});

	it("asks for a token when a source has no credential", () => {
		const p = changesProblem(
			changes({
				sources: [
					{
						repositoryId: crypto.randomUUID(),
						repo: "booklogr/api",
						serviceId: "s",
						serviceName: "api",
						status: "failed",
						credential: null,
						problem: {
							code: "no-credential",
							message: "No credential",
							action: "add-credential",
						},
						checkedAt: null,
					},
				],
			}),
		);
		expect(p?.text).toBe(
			"Add a git host token, or sign in to git on this machine, to see deploys and merges",
		);
		expect(p?.action?.label).toBe("Add a token");
	});

	it("is quiet when every source read", () => {
		expect(changesProblem(changes({ state: "ok" }))).toBeNull();
	});
});
