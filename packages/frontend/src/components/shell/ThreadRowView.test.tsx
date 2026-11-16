// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import fs from "node:fs";
import path from "node:path";
import type {
	ThreadRow as FeedRow,
	IncidentWithRelations,
	ThreadUnit,
} from "@prismalens/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { relTime } from "@/components/kit/rel-time";
import { type ThreadRow, ThreadRowView, unitRow } from "./ThreadList";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...p }: { children: ReactNode; to: string }) => (
		<a href={p.to}>{children}</a>
	),
	useLocation: () => ({ pathname: "/new" }),
}));

vi.mock("@/lib/api/hooks", () => ({
	useCancelInvestigation: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useRenameThread: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const at = (m: number) => new Date(Date.UTC(2026, 10, 4, 12, m)).toISOString();

const thread = (p: Partial<FeedRow> = {}) =>
	({
		id: crypto.randomUUID(),
		incidentId: null,
		scheduleId: null,
		repositoryId: null,
		kind: "chat",
		status: "completed",
		title: "Cart performance issue",
		rootCause: null,
		triggerType: "manual",
		section: "settled",
		lastActivityAt: at(5),
		lastVisitedAt: null,
		settledAt: null,
		unseen: false,
		latestText: null,
		projectName: null,
		titleSetBy: null,
		serviceName: null,
		createdAt: at(1),
		startedAt: at(1),
		awaitingApprovalAt: null,
		...p,
	}) as FeedRow;

const unit = (threads: FeedRow[], chip?: ThreadUnit["incident"]) =>
	({
		section: threads[0]?.section ?? "settled",
		incident: chip ?? null,
		threads,
	}) as ThreadUnit;

const incident = {
	id: "i1",
	number: 1,
	title: "CheckoutLatencyHigh",
	status: "investigating",
	severity: "high",
	triggeredAt: new Date().toISOString(),
	alertCount: 1,
	alerts: [
		{
			id: "a",
			status: "triggered",
			source: "prometheus",
			triggeredAt: new Date().toISOString(),
		},
	],
	investigations: [],
} as unknown as IncidentWithRelations;

const base = unitRow(
	{
		section: "active",
		incident: {
			id: "i1",
			number: 1,
			title: "CheckoutLatencyHigh",
			severity: "high",
			status: "investigating",
		},
		threads: [
			{
				id: "r1",
				incidentId: "i1",
				kind: "investigation",
				status: "completed",
				lastActivityAt: new Date().toISOString(),
			} as unknown as FeedRow,
		],
	} as ThreadUnit,
	incident,
);

describe("a sidebar row (one state per row)", () => {
	it.each([null, "asks", "failed", "working", "ready", "new"] as const)(
		"shows one mark for state %s, firing or not",
		async (state) => {
			for (const firing of [false, true]) {
				const row: ThreadRow = { ...base, state, firing };
				const host = document.createElement("div");
				const root = createRoot(host);
				await act(async () =>
					root.render(<ThreadRowView row={row} now={Date.now()} on={false} />),
				);
				expect(
					host.querySelectorAll(
						'[data-testid="tree-state"], [data-testid="row-origin"]',
					),
				).toHaveLength(1);
				await act(async () => root.unmount());
			}
		},
	);
});

describe("unitState precedence pairs (#1024)", () => {
	it("prefers ask over failed", () => {
		const ask = thread({ status: "running", awaitingApprovalAt: at(4) });
		const failed = thread({ status: "failed", unseen: true });
		expect(unitRow(unit([failed, ask])).state).toBe("asks");
	});

	it("prefers paused over failed", () => {
		const paused = thread({
			paused: { reason: "merged" },
		} as unknown as Partial<FeedRow>);
		const failed = thread({ status: "failed", unseen: true });
		expect(unitRow(unit([failed, paused])).state).toBe("asks");
	});

	it("prefers failed over limited", () => {
		const failed = thread({ status: "failed", unseen: true });
		const limited = thread({
			limit: { resetsAt: at(10) },
		} as unknown as Partial<FeedRow>);
		expect(unitRow(unit([limited, failed])).state).toBe("failed");
	});

	it("prefers limited over working", () => {
		const limited = thread({
			limit: { resetsAt: at(10) },
		} as unknown as Partial<FeedRow>);
		const working = thread({ status: "running" });
		expect(unitRow(unit([working, limited])).state).toBe("limited");
	});

	it("prefers working over ready", () => {
		const working = thread({ status: "running" });
		const ready = thread({ unseen: true, rootCause: "Database lock" });
		expect(unitRow(unit([ready, working])).state).toBe("working");
	});

	it("prefers ready over a quiet row", () => {
		const ready = thread({ unseen: true, rootCause: "Database lock" });
		const quiet = thread({});
		expect(unitRow(unit([quiet, ready])).state).toBe("ready");
		expect(unitRow(unit([quiet])).state).toBeNull();
	});
});

describe("hints (#1024)", () => {
	it("includes paused reason in hint", () => {
		const paused = thread({
			paused: { reason: "merged" },
		} as unknown as Partial<FeedRow>);
		const row = unitRow(unit([paused]));
		expect(row.hint).toContain("Automatic updates paused: merged");
	});

	// b03f1e07d: the reset reads relative, "resumes in 2h".
	it("includes formatted resetsAt in hint for limited thread", () => {
		const resetsAt = "2026-11-10T14:30:00.000Z";
		const limited = thread({
			limit: { resetsAt },
		} as unknown as Partial<FeedRow>);
		const row = unitRow(unit([limited]));
		const expected = `Limited · resumes ${relTime(resetsAt, Date.now())}`;
		expect(row.hint).toContain(expected);
	});

	it("appends PR failing to hint and leaves state unchanged", () => {
		const quiet = thread({
			pr: {
				id: "pr-4",
				number: 4,
				tone: "failing",
				repo: "repo",
				branch: "feat",
				baseRef: "main",
				state: "open",
				url: "https://example.com",
				checks: { state: "none", total: 0, failed: 0, pending: 0 },
				review: "none",
				conflicts: false,
			} as unknown as FeedRow["pr"],
		});
		const row = unitRow(unit([quiet]));
		expect(row.hint).toContain("PR failing");
		expect(row.state).toBeNull();
	});

	it("starts hint with Draft when hasDraft is true", () => {
		const draftThread = thread({ hasDraft: true });
		const row = unitRow(unit([draftThread]));
		expect(row.hint.startsWith("Draft")).toBe(true);
	});
});

describe("ThreadRowView settle action (#1024)", () => {
	it("renders settle action with accessible label Settle: ends this thread's watches and schedules", async () => {
		const onSettle = vi.fn();
		const row: ThreadRow = {
			...base,
			thread: thread({ status: "completed" }),
		};
		const host = document.createElement("div");
		const root = createRoot(host);
		await act(async () => {
			root.render(
				<ThreadRowView
					row={row}
					now={Date.now()}
					on={false}
					onSettle={onSettle}
					detailed={false}
				/>,
			);
		});

		const btn = host.querySelector('[data-testid="thread-settle"]');
		expect(btn?.getAttribute("aria-label")).toBe(
			"Settle: ends this thread's watches and schedules",
		);
		await act(async () => root.unmount());
	});

	it("verifies no element in ThreadList.tsx settle controls is labelled Done", () => {
		const source = fs.readFileSync(
			path.resolve(__dirname, "ThreadList.tsx"),
			"utf8",
		);
		expect(source.match(/label="Done"/)).toBeNull();
	});
});
