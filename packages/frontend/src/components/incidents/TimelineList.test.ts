// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TimelineEntryWithRelations } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineList } from "./TimelineList";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const entry = (
	overrides: Partial<TimelineEntryWithRelations>,
): TimelineEntryWithRelations =>
	({
		id: "e1",
		incidentId: "inc-1",
		type: "status_changed",
		title: "Status changed",
		description: "Status changed from triggered to resolved",
		source: "system",
		metadata: null,
		occurredAt: "2026-10-07T10:00:00.000Z",
		createdAt: "2026-10-07T10:00:00.000Z",
		...overrides,
	}) as TimelineEntryWithRelations;

describe("TimelineList summary view", () => {
	it("shows the reason of a resolve-by-absence entry without opening it (#673 w23)", () => {
		act(() =>
			root.render(
				createElement(TimelineList, {
					items: [
						{
							kind: "entry",
							entry: entry({
								title: "Alerts cleared: no Alertmanager still lists it",
								description:
									"Status changed from triggered to resolved: no connected Alertmanager still lists HighLatency",
								metadata: { reason: "alertmanager-absence" },
							}),
						},
						{ kind: "entry", entry: entry({ id: "e2" }) },
					],
				}),
			),
		);
		const rows = container.querySelectorAll('[data-testid="timeline-row"]');
		expect(rows[0].textContent).toContain("no connected Alertmanager still lists HighLatency");
		expect(rows[1].textContent).not.toContain("Status changed from");
	});
});
