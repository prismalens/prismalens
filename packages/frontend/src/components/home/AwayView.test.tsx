// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AwayView as AwayData } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AwayFold, digestLines } from "./AwayView";

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
});

const thread = (id: string) => ({ thread: { id }, events: [] });
const data = (since: string | null) =>
	({
		since,
		long: false,
		groups: [
			{ root: { id: "a" }, threads: [thread("a"), thread("a1")] },
			{ root: { id: "b" }, threads: [thread("b")] },
		],
	}) as unknown as AwayData;

describe("Home's folded away view (sheet §1, #1101 category 3)", () => {
	it("is one closed mark with the count, naming what changed in its label", async () => {
		await act(async () =>
			root.render(
				<TooltipProvider>
					<AwayFold data={data(null)} now={0} onOpen={() => {}} />
				</TooltipProvider>,
			),
		);
		const line = container.querySelector('[data-testid="away-fold"]');
		// The fold is a mark and its count, its words in the label (the commit making it a mark).
		expect(line?.textContent).toBe("3");
		expect(line?.getAttribute("aria-label")).toBe("3 threads changed");
		expect(line?.getAttribute("aria-expanded")).toBe("false");
	});

	it("opens the list only when clicked", async () => {
		const onOpen = vi.fn();
		await act(async () =>
			root.render(
				<TooltipProvider>
					<AwayFold data={data(null)} now={0} onOpen={onOpen} />
				</TooltipProvider>,
			),
		);
		expect(onOpen).toHaveBeenCalledTimes(0);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[data-testid="away-fold"]')
				?.click(),
		);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});

describe("Home's what changed reads an incident once", () => {
	const event = (threadId: string, kind: string, at: string) => ({
		id: `${threadId}-${kind}`,
		threadId,
		kind,
		detail: null,
		resetsAt: null,
		at,
		readAt: null,
		thread: {
			id: threadId,
			incident: null,
			cause: null,
			answer: null,
			error: null,
		},
	});
	const entry = (
		id: string,
		title: string,
		status: string,
		events: ReturnType<typeof event>[],
		incident: string | null,
	) => ({
		thread: {
			id,
			title,
			status,
			incident: incident ? { id: incident, number: 1, severity: "low" } : null,
		},
		events,
	});
	const away = (threads: ReturnType<typeof entry>[]) =>
		({
			since: null,
			long: false,
			groups: [{ root: { id: "r" }, threads }],
		}) as unknown as AwayData;

	it("shows one line for a failed run and its retry, titled and marked by the retry", () => {
		const lines = digestLines(
			away([
				entry(
					"t-failed",
					"Test alert: repo is failing",
					"failed",
					[event("t-failed", "failed", "2026-11-24T10:00:00.000Z")],
					"inc-1",
				),
				entry(
					"t-retry",
					"Test alert on demo repo",
					"done",
					[event("t-retry", "finished", "2026-11-24T10:03:00.000Z")],
					"inc-1",
				),
			]),
		);
		expect(lines.map((l) => [l.id, l.title, l.status])).toEqual([
			["t-retry", "Test alert on demo repo", "done"],
		]);
	});

	it("keeps threads of different incidents, and threads with no incident, apart", () => {
		const lines = digestLines(
			away([
				entry(
					"a",
					"A",
					"done",
					[event("a", "finished", "2026-11-24T10:00:00.000Z")],
					"inc-1",
				),
				entry(
					"b",
					"B",
					"done",
					[event("b", "finished", "2026-11-24T10:01:00.000Z")],
					"inc-2",
				),
				entry(
					"c",
					"C",
					"done",
					[event("c", "finished", "2026-11-24T10:02:00.000Z")],
					null,
				),
				entry(
					"d",
					"D",
					"done",
					[event("d", "finished", "2026-11-24T10:03:00.000Z")],
					null,
				),
			]),
		);
		expect(lines.map((l) => l.id)).toEqual(["d", "c", "b", "a"]);
	});
});
