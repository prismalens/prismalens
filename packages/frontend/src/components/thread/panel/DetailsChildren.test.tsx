// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	childrenSpan,
	DetailsChildren,
	splitChildren,
} from "./DetailsChildren";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to?: string;
		params?: Record<string, string>;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

describe("splitChildren and childrenSpan (#1101)", () => {
	it("orders failed, then running and queued; answered and stopped go to done", () => {
		const nodes = [
			{ id: "1", state: "answered" as const },
			{ id: "2", state: "running" as const },
			{ id: "3", state: "failed" as const },
			{ id: "4", state: "stopped" as const },
			{ id: "5", state: "queued" as const },
		];
		const { shown, done } = splitChildren(nodes);
		expect(shown.map((n) => n.id)).toEqual(["3", "2", "5"]);
		expect(done.map((n) => n.id)).toEqual(["1", "4"]);
	});

	it("counts heading + shown + 1 previous row, and no previous row when none are done", () => {
		const withDone = [
			{ state: "failed" as const },
			{ state: "running" as const },
			{ state: "answered" as const },
			{ state: "stopped" as const },
		];
		// 1 heading + 2 shown + 1 previous = 4
		expect(childrenSpan(withDone)).toBe(4);

		const withoutDone = [
			{ state: "failed" as const },
			{ state: "running" as const },
			{ state: "queued" as const },
		];
		// 1 heading + 3 shown + 0 previous = 4
		expect(childrenSpan(withoutDone)).toBe(4);

		const empty: {
			state: "failed" | "running" | "queued" | "answered" | "stopped";
		}[] = [];
		// 1 heading + 0 shown + 0 previous = 1
		expect(childrenSpan(empty)).toBe(1);
	});
});

describe("DetailsChildren (#1101)", () => {
	it("renders failed first, running time, previous button with done rows, and heading counts", async () => {
		const now = 1_700_000_000_000;
		vi.useFakeTimers();
		vi.setSystemTime(now);

		const startedAt = new Date(now - 4 * 60_000).toISOString();
		const nodes = [
			{
				id: "c-ans",
				number: 1,
				title: "Answered child",
				state: "answered" as const,
				harness: null,
				startedAt: null,
			},
			{
				id: "c-run",
				number: 2,
				title: "Running child",
				state: "running" as const,
				harness: null,
				startedAt,
			},
			{
				id: "c-fail",
				number: 3,
				title: "Failed child",
				state: "failed" as const,
				harness: null,
				startedAt: null,
			},
			{
				id: "c-stop",
				number: 4,
				title: "Stopped child",
				state: "stopped" as const,
				harness: null,
				startedAt: null,
			},
		];

		await act(async () => {
			root.render(<DetailsChildren nodes={nodes} />);
		});

		// Failed row first with data-state="failed"
		const childRows = container.querySelectorAll(
			'[data-testid="details-child"]',
		);
		expect(childRows).toHaveLength(2);
		expect(childRows[0]?.getAttribute("data-state")).toBe("failed");
		expect(childRows[1]?.getAttribute("data-state")).toBe("running");

		// A running child with startedAt 4 minutes before a faked Date.now() shows 4m in details-child-time
		const timeEl = childRows[1]?.querySelector(
			'[data-testid="details-child-time"]',
		);
		expect(timeEl?.textContent).toBe("4m");

		// Heading shows the running and failed counts
		const heading = container.querySelector(
			'[data-testid="details-children-heading"]',
		);
		expect(heading?.textContent).toContain("Children");
		expect(heading?.textContent).toContain("1running");
		expect(heading?.textContent).toContain("1failed");

		const badges = heading?.querySelectorAll(".tabular-nums");
		expect(badges).toHaveLength(2);
		expect(badges?.[0]?.children[1]?.textContent).toBe("1");
		expect(badges?.[0]?.children[2]?.textContent).toBe("running");
		expect(badges?.[1]?.children[1]?.textContent).toBe("1");
		expect(badges?.[1]?.children[2]?.textContent).toBe("failed");

		// The details-children-previous button reads Previous 2 and clicking it shows the 2 done rows
		const prevBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="details-children-previous"]',
		);
		expect(prevBtn?.textContent).toContain("Previous 2");

		await act(async () => {
			prevBtn?.click();
		});

		const allRows = container.querySelectorAll('[data-testid="details-child"]');
		expect(allRows).toHaveLength(4);
		expect(allRows[2]?.getAttribute("data-state")).toBe("answered");
		expect(allRows[3]?.getAttribute("data-state")).toBe("stopped");
	});
});
