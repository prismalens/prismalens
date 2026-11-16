// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadUnit } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import { HOME_ORDER, HOME_REST, homeItems } from "./phone-home";

describe("phone-home", () => {
	it("exports HOME_ORDER with expected order and HOME_REST as 15", () => {
		expect(HOME_ORDER).toEqual([
			"approval",
			"question",
			"limited",
			"blocked",
			"failed",
			"working",
			"waiting",
			"done",
		]);
		expect(HOME_REST).toBe(15);
	});

	it("homeItems groups items into needs and rest, links to ask for needs, and calculates more", () => {
		const now = Date.parse("2026-11-12T12:00:00.000Z");

		const threadNeeds = {
			id: "thread-1",
			incidentId: null,
			kind: "chat" as const,
			title: "Needs approval thread",
			status: "running" as const,
			awaitingApprovalAt: "2026-11-12T10:30:00.000Z",
			startedAt: "2026-11-12T10:00:00.000Z",
			completedAt: null,
			accessLevel: "supervised" as const,
			harness: "codex",
			model: "gpt-4o",
			effort: null,
			error: null,
			createdAt: "2026-11-12T10:00:00.000Z",
			updatedAt: "2026-11-12T10:00:00.000Z",
			lastActivityAt: "2026-11-12T11:00:00.000Z",
			hasChildren: false,
			origin: "local" as const,
			schemaVersion: 1,
			summary: null,
			rootCause: null,
			rootCauseCategory: null,
			section: "active" as const,
			lastVisitedAt: null,
			settledAt: null,
			unseen: false,
			latestText: null,
			projectName: null,
			titleSetBy: null,
			serviceName: null,
		};

		const threadRest = {
			id: "thread-2",
			incidentId: null,
			kind: "chat" as const,
			title: "Working thread",
			status: "running" as const,
			startedAt: "2026-11-12T10:00:00.000Z",
			completedAt: null,
			accessLevel: "auto" as const,
			harness: "claude-code",
			model: "claude-3-7-sonnet",
			effort: null,
			error: null,
			createdAt: "2026-11-12T10:00:00.000Z",
			updatedAt: "2026-11-12T10:00:00.000Z",
			lastActivityAt: "2026-11-12T11:30:00.000Z",
			hasChildren: false,
			origin: "local" as const,
			schemaVersion: 1,
			summary: null,
			rootCause: null,
			rootCauseCategory: null,
			section: "active" as const,
			lastVisitedAt: null,
			settledAt: null,
			unseen: false,
			latestText: null,
			projectName: null,
			titleSetBy: null,
			serviceName: null,
		};

		const units: ThreadUnit[] = [
			{
				section: "active",
				incident: null,
				threads: [threadNeeds, threadRest],
			},
		];

		const askEntry: RowAskEntry = {
			ended: false,
			accessLevel: "supervised",
			ask: {
				askId: "ask-123",
				threadId: "thread-1",
				kind: "permission",
				requiresHost: false,
				source: { kind: "agent" },
				openedAt: "2026-11-12T10:30:00.000Z",
				title: "Approve bash command",
			},
		};
		const asks = new Map<string, RowAskEntry[]>([["thread-1", [askEntry]]]);

		const res = homeItems(units, asks, now);

		expect(res.needs.length).toBe(1);
		expect(res.needs[0]?.id).toBe("thread-1");
		expect(res.needs[0]?.status).toBe("approval");
		expect(res.needs[0]?.needs).toBe(true);
		expect(res.needs[0]?.line).toBe("Approve bash command");
		expect(res.needs[0]?.link).toEqual({
			to: "/threads/$id",
			params: { id: "thread-1" },
			search: { ask: "ask-123" },
		});

		expect(res.rest.length).toBe(1);
		expect(res.rest[0]?.id).toBe("thread-2");
		expect(res.rest[0]?.status).toBe("working");
		expect(res.rest[0]?.needs).toBe(false);
		expect(res.rest[0]?.link).toEqual({
			to: "/threads/$id",
			params: { id: "thread-2" },
		});

		expect(res.more).toBe(0);
	});
});
