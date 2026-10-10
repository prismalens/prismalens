// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TimelineEntryWithRelations } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entryDescription, entryTitle, TimelineList } from "./TimelineList";

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

describe("status words (#673 walk 4)", () => {
	it("formats investigating to closed with custom title (#673 walk 4)", () => {
		const e = entry({
			title: "Resolved, cause recorded",
			description: "Status changed from investigating to closed",
			metadata: { previousStatus: "investigating", newStatus: "closed" },
		});
		expect(entryDescription(e)).toBe("From Acknowledged to Resolved");
		expect(entryTitle(e)).toBe("Resolved, cause recorded");
	});

	it("formats closed to investigating with reopened title (#673 walk 4)", () => {
		const e = entry({
			title: "Incident reopened",
			description: "Status changed from closed to investigating",
			metadata: { previousStatus: "closed", newStatus: "investigating" },
		});
		expect(entryDescription(e)).toBe("From Resolved to Acknowledged");
		expect(entryTitle(e)).toBe("Incident reopened");
	});

	it("formats triggered to resolved with default title (#673 walk 4)", () => {
		const e = entry({
			title: "Status changed",
			description: "Status changed from triggered to resolved",
			metadata: { previousStatus: "triggered", newStatus: "resolved" },
		});
		expect(entryDescription(e)).toBe("From Triggered to Alerts cleared");
		expect(entryTitle(e)).toBe("Alerts cleared");
	});

	it("keeps reason suffix in description (#673 walk 4)", () => {
		const e = entry({
			title: "Status changed",
			description:
				"Status changed from triggered to resolved: no connected Alertmanager still lists HighLatency",
			metadata: { previousStatus: "triggered", newStatus: "resolved" },
		});
		expect(entryDescription(e)).toBe(
			"From Triggered to Alerts cleared: no connected Alertmanager still lists HighLatency",
		);
	});

	it("collapses same-word status transitions to single word (#673 walk 4)", () => {
		const e = entry({
			title: "Status changed",
			description: "Status changed from identified to monitoring",
			metadata: { previousStatus: "identified", newStatus: "monitoring" },
		});
		expect(entryDescription(e)).toBe("Acknowledged");
		expect(entryTitle(e)).toBe("Acknowledged");
	});

	it("leaves entry without metadata unchanged (#673 walk 4)", () => {
		const e = entry({
			title: "Status changed",
			description: "Status changed from triggered to resolved",
			metadata: null,
		});
		expect(entryDescription(e)).toBe("Status changed from triggered to resolved");
		expect(entryTitle(e)).toBe("Status changed");
	});

	it("leaves non-status_changed entry titled Status changed unchanged (#673 walk 4)", () => {
		const e = entry({
			type: "comment",
			title: "Status changed",
			description: "Status changed from triggered to resolved",
			metadata: { previousStatus: "triggered", newStatus: "resolved" },
		});
		expect(entryTitle(e)).toBe("Status changed");
	});

	it("renders full list showing human words and suppressing raw status enum text (#673 walk 4)", () => {
		act(() =>
			root.render(
				createElement(TimelineList, {
					full: true,
					items: [
						{
							kind: "entry",
							entry: entry({
								title: "Resolved, cause recorded",
								description: "Status changed from investigating to closed",
								metadata: { previousStatus: "investigating", newStatus: "closed" },
							}),
						},
					],
				}),
			),
		);
		const rows = container.querySelectorAll('[data-testid="timeline-row"]');
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain("From Acknowledged to Resolved");
		expect(rows[0].textContent).not.toContain("investigating");
		expect(rows[0].textContent).not.toContain("closed");
	});
});
