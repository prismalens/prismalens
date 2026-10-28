// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	InvestigationWithRelations,
} from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transcript } from "@/components/investigation/Transcript";
import { formatClock, formatDayClock } from "@/lib/format-time";
import { deriveTranscript } from "@/lib/investigation-events";
import { endReasonStatus, resumeFailed, stripWords } from "./RunPage";
import { RunStrip } from "./RunStrip";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useLocation: () => ({ hash: "" }),
	useSearch: () => ({}),
}));
vi.mock("./RunsMenu", () => ({ RunsMenu: () => null }));
vi.mock("@/components/incidents/RunTree", () => ({ RunDot: () => null }));

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-10-28T10:00:00").getTime();
const STOPPED = new Date("2026-10-28T08:52:00").toISOString();
const RESUMED = new Date("2026-10-28T09:14:00").toISOString();
const MONDAY = new Date("2026-10-26T18:41:00").toISOString();
const NOT_RESUMED =
	"Not resumed: Codex isn't signed in on studio-mac. Sign in there, then resume.";

function restartMessage(
	by: "auto" | "operator",
	stoppedAt = STOPPED,
	resumedAt = RESUMED,
): CanonicalEvent {
	return {
		kind: "operator_message",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq: 2,
		label: null,
		text: "PrismaLens stopped and started again. Continue the investigation.",
		delivered: true,
		mode: "queue",
		ts: resumedAt,
		via: { harness: "claude-code", restart: { stoppedAt, resumedAt, by } },
	} as unknown as CanonicalEvent;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

async function renderTranscript(
	events: CanonicalEvent[],
	extra: Partial<React.ComponentProps<typeof Transcript>> = {},
	run?: NonNullable<Parameters<typeof deriveTranscript>[1]>["run"],
) {
	const items = deriveTranscript(events, { run });
	await act(async () => {
		root.render(
			<Transcript
				items={items}
				incidentId="inc-1"
				agent="Claude Code"
				{...extra}
			/>,
		);
	});
}

const operatorMessage = () =>
	container.querySelector('[data-testid="transcript-operator"]');

describe("a message PrismaLens wrote after a restart (#981)", () => {
	it("is labelled PrismaLens with its time, never You, after a divider with the gap", async () => {
		await renderTranscript([restartMessage("auto")]);
		const divider = container.querySelector('[role="separator"]');
		expect(divider?.textContent).toBe(
			`Stopped at ${formatClock(STOPPED)}, resumed at ${formatClock(RESUMED)}`,
		);
		expect(operatorMessage()?.textContent).toContain(
			`PrismaLens, sent automatically at ${formatClock(RESUMED)}`,
		);
		expect(operatorMessage()?.textContent).not.toContain("You");
		const order = divider?.compareDocumentPosition(operatorMessage() as Node);
		expect((order ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("reads as sent when you pressed Resume when you did", async () => {
		await renderTranscript([restartMessage("operator")]);
		expect(operatorMessage()?.textContent).toContain(
			"PrismaLens, sent when you pressed Resume",
		);
		expect(operatorMessage()?.textContent).not.toContain("You");
	});

	it("prefixes the day on a time that is not today", async () => {
		await renderTranscript([restartMessage("auto", MONDAY, RESUMED)]);
		const text = container.querySelector('[role="separator"]')?.textContent;
		expect(text).toBe(
			`Stopped at ${formatDayClock(MONDAY, NOW)}, resumed at ${formatClock(RESUMED)}`,
		);
		expect(text).toMatch(/^Stopped at \S+ \d\d:\d\d, resumed at \d\d:\d\d$/);
	});

	it("leaves an operator's own message labelled You", async () => {
		const own = {
			...restartMessage("auto"),
			via: undefined,
		} as unknown as CanonicalEvent;
		await renderTranscript([own]);
		expect(container.querySelector('[role="separator"]')).toBeNull();
		expect(operatorMessage()?.textContent).toContain("You,");
	});
});

const interrupted = {
	status: "failed",
	live: false,
	endReason: "interrupted",
	error: NOT_RESUMED,
	completedAt: MONDAY,
	continuable: true,
	id: RUN_ID,
};

describe("an interrupted run's ended card (#981)", () => {
	it("gives the reason, the stop time and a primary Resume that calls it", async () => {
		const onResume = vi.fn();
		await renderTranscript(
			[],
			{ resume: { onResume, pending: false } },
			interrupted,
		);
		const card = container.querySelector(
			'[data-testid="transcript-interrupted"]',
		);
		expect(card?.textContent).toContain("Interrupted (PrismaLens restarted)");
		expect(card?.textContent).toContain(NOT_RESUMED);
		expect(card?.textContent).toContain(
			"Resume, or send a message below with any agent.",
		);
		expect(container.querySelector('[role="separator"]')?.textContent).toBe(
			`PrismaLens stopped at ${formatDayClock(MONDAY, NOW)}`,
		);
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[data-testid="transcript-resume"]')
				?.click();
		});
		expect(onResume).toHaveBeenCalledTimes(1);
	});

	it("keeps today's sentence when the run carries no Not resumed reason, and offers no Resume without a handler", async () => {
		await renderTranscript(
			[],
			{},
			{ ...interrupted, error: "PrismaLens restarted" },
		);
		const card = container.querySelector(
			'[data-testid="transcript-interrupted"]',
		);
		expect(card?.textContent).toContain(
			"Its last command may or may not have completed.",
		);
		expect(
			container.querySelector('[data-testid="transcript-resume"]'),
		).toBeNull();
	});
});

describe("the Resume button on the run strip (#981)", () => {
	const strip = (onResume?: () => void) =>
		act(async () => {
			root.render(
				<RunStrip
					state="failed"
					label="Codex interrupted"
					detail="PrismaLens restarted, not resumed"
					onResume={onResume}
					incidentId="inc-1"
					runs={[]}
					current={RUN_ID}
				/>,
			);
		});

	it("calls resume when pressed", async () => {
		const onResume = vi.fn();
		await strip(onResume);
		const button = container.querySelector<HTMLButtonElement>(
			'[data-testid="run-strip-resume"]',
		);
		expect(button?.textContent).toBe("Resume");
		await act(async () => button?.click());
		expect(onResume).toHaveBeenCalledTimes(1);
	});

	it("shows none on a run that was not interrupted", async () => {
		await strip(undefined);
		expect(
			container.querySelector('[data-testid="run-strip-resume"]'),
		).toBeNull();
	});

	it("shows a refused Resume's message through the error toast", () => {
		const toast = vi.fn();
		resumeFailed(toast)(
			new Error("The run was not interrupted by a restart, or is live"),
		);
		expect(toast).toHaveBeenCalledWith({
			title: "Run not resumed",
			description: "The run was not interrupted by a restart, or is live",
			variant: "destructive",
		});
	});
});

describe("the strip's words after a restart (#981)", () => {
	const inv = (over: Record<string, unknown> = {}) =>
		({
			id: RUN_ID,
			kind: "investigation",
			status: "running",
			error: null,
			completedAt: null,
			updatedAt: MONDAY,
			...over,
		}) as unknown as InvestigationWithRelations;
	const words = (
		i: InvestigationWithRelations,
		state: "working" | "failed",
		restart: Parameters<typeof stripWords>[7],
	) =>
		stripWords(i, state, "Working on it", "Run 1", NOW, "Codex", null, restart);

	it("says a live run resumed after PrismaLens restarted, or by you", () => {
		const base = { stoppedAt: STOPPED, resumedAt: RESUMED };
		expect(words(inv(), "working", { ...base, by: "auto" }).detail).toBe(
			"Resumed after PrismaLens restarted",
		);
		expect(words(inv(), "working", { ...base, by: "operator" }).detail).toBe(
			"Resumed by you",
		);
		expect(words(inv(), "working", null).detail).toBe("Working on it");
	});

	it("names why an interrupted run was not resumed", () => {
		const run = inv({
			status: "failed",
			endReason: "interrupted",
			error: NOT_RESUMED,
		});
		expect(words(run, "failed", null).detail).toBe(
			"PrismaLens restarted, not resumed",
		);
		expect(endReasonStatus(run, "Codex")).toEqual({
			text: "Interrupted (PrismaLens restarted)",
			sub: NOT_RESUMED,
		});
	});

	it("keeps today's text on an interrupted run without that prefix", () => {
		const run = inv({
			status: "failed",
			endReason: "interrupted",
			error: "boom",
		});
		expect(endReasonStatus(run, "Codex")?.sub).toContain(
			"Its last command may or may not have completed.",
		);
		expect(words(run, "failed", null).detail).toMatch(/^PrismaLens restarted/);
	});
});
