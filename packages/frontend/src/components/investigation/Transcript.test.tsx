// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "@/lib/format-time";
import type { TranscriptItem } from "@/lib/investigation-events";
import { Transcript } from "./Transcript";

const mutateSpy = vi.fn();

vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useAnswerAsk: () => ({
		mutate: mutateSpy,
		isPending: false,
		isError: false,
	}),
}));

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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mutateSpy.mockClear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("Transcript AskCard", () => {
	const askItem: TranscriptItem = {
		kind: "ask",
		key: "ask-1",
		askId: "00000000-0000-0000-0000-000000000001",
		title: "rm -rf /tmp/test",
		detail: "/tmp/test",
		at: "2026-10-09T10:00:00Z",
		expiresAt: "2026-10-09T10:10:00Z",
		clamped: false,
		state: "waiting",
	};

	it("Approve click calls mutate with approve decision", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={[askItem]}
					incidentId="inc-1"
					runId="run-1"
					agent="Claude Code"
				/>,
			);
		});

		const approveButton = container.querySelector(
			'[data-testid="ask-approve"]',
		) as HTMLButtonElement | null;
		expect(approveButton).not.toBeNull();
		await act(async () => {
			approveButton?.click();
		});

		expect(mutateSpy).toHaveBeenCalledTimes(1);
		expect(mutateSpy).toHaveBeenCalledWith({
			id: "run-1",
			askId: "00000000-0000-0000-0000-000000000001",
			decision: "approve",
		});
	});

	it("Deny click calls mutate with deny decision", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={[askItem]}
					incidentId="inc-1"
					runId="run-1"
					agent="Claude Code"
				/>,
			);
		});

		const denyButton = container.querySelector(
			'[data-testid="ask-deny"]',
		) as HTMLButtonElement | null;
		expect(denyButton).not.toBeNull();
		await act(async () => {
			denyButton?.click();
		});

		expect(mutateSpy).toHaveBeenCalledTimes(1);
		expect(mutateSpy).toHaveBeenCalledWith({
			id: "run-1",
			askId: "00000000-0000-0000-0000-000000000001",
			decision: "deny",
		});
	});

	it("an ended item shows no buttons and the end line", async () => {
		const endedItem: TranscriptItem = {
			...askItem,
			state: "ended",
		};

		await act(async () => {
			root.render(
				<Transcript
					items={[endedItem]}
					incidentId="inc-1"
					runId="run-1"
					agent="Claude Code"
				/>,
			);
		});

		const approveButton = container.querySelector(
			'[data-testid="ask-approve"]',
		);
		const denyButton = container.querySelector('[data-testid="ask-deny"]');
		expect(approveButton).toBeNull();
		expect(denyButton).toBeNull();

		const endLine = container.querySelector(
			'[data-testid="transcript-ask-end"]',
		);
		expect(endLine).not.toBeNull();
		expect(endLine?.textContent).toBe("Not answered before the run ended");
	});

	it("shows unclamped waiting text with expiry clock", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={[askItem]}
					incidentId="inc-1"
					runId="run-1"
					agent="Claude Code"
				/>,
			);
		});
		expect(container.textContent).toContain(
			`Denied at ${formatClock(askItem.expiresAt)} if no one answers`,
		);
	});

	it("shows clamped waiting text when the run time limit is near", async () => {
		const clampedWaiting: TranscriptItem = {
			...askItem,
			clamped: true,
		};
		await act(async () => {
			root.render(
				<Transcript
					items={[clampedWaiting]}
					incidentId="inc-1"
					runId="run-1"
					agent="Claude Code"
				/>,
			);
		});
		expect(container.textContent).toContain(
			`The run's time limit is near, so this ask expires at ${formatClock(askItem.expiresAt)}`,
		);
	});

	it("shows unclamped timed_out text when no one answered in time", async () => {
		const unclampedTimedOut: TranscriptItem = {
			...askItem,
			state: "timed_out",
			clamped: false,
		};
		await act(async () => {
			root.render(
				<Transcript
					items={[unclampedTimedOut]}
					incidentId="inc-1"
					runId="run-1"
					agent="Claude Code"
				/>,
			);
		});
		const endLine = container.querySelector(
			'[data-testid="transcript-ask-end"]',
		);
		expect(endLine?.textContent).toBe(
			"No one answered in 10 minutes, so it was denied",
		);
	});

	it("shows clamped timed_out text when the run's time limit was reached", async () => {
		const clampedTimedOut: TranscriptItem = {
			...askItem,
			state: "timed_out",
			clamped: true,
		};
		await act(async () => {
			root.render(
				<Transcript
					items={[clampedTimedOut]}
					incidentId="inc-1"
					runId="run-1"
					agent="Claude Code"
				/>,
			);
		});
		const endLine = container.querySelector(
			'[data-testid="transcript-ask-end"]',
		);
		expect(endLine?.textContent).toBe(
			"Denied: the run's time limit was reached",
		);
	});
});
