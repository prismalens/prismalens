// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ThreadRow as FeedRow,
	IncidentWithRelations,
	ThreadUnit,
} from "@prismalens/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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
