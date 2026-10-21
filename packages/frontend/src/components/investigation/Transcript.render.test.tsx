// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { replaceEqualDeep } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveSteps, type RunStep } from "@/components/run/run-steps";
import { formatElapsed } from "@/lib/format-time";
import {
	deriveTranscript,
	shareItems,
	type TranscriptItem,
} from "@/lib/investigation-events";
import { Transcript, type TranscriptSteps } from "./Transcript";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		className,
		"data-testid": testId,
	}: {
		children: React.ReactNode;
		to: string;
		className?: string;
		"data-testid"?: string;
	}) => (
		<a href={to} className={className} data-testid={testId}>
			{children}
		</a>
	),
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
	window.__renderProbe?.reset();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

function makeToolStepEvents(count: number, prose = true): CanonicalEvent[] {
	const events: CanonicalEvent[] = [];
	const base = (seq: number) => ({
		runId: "run-1",
		branchId: "main",
		path: [] as string[],
		seq,
		ts: new Date(1700000000000 + seq * 1000).toISOString(),
	});

	for (let i = 1; i <= count; i++) {
		const callId = `call-tool-${i}`;
		const isFile = i % 2 === 0;
		const isFailed = i === 3;
		events.push({
			kind: "agent_step",
			...base(i * 2 - 1),
			label: "agent",
			text: prose ? `Step ${i} text` : "",
			toolCalls: [
				{
					toolCallId: callId,
					name: isFile ? "read_file" : "bash",
					args: isFile
						? { path: `repo/file-${i}.txt` }
						: { command: `cmd-${i}` },
				},
			],
		});
		events.push({
			kind: "tool_result",
			...base(i * 2),
			label: null,
			result: {
				toolCallId: callId,
				name: isFile ? "read_file" : "bash",
				toolCategory: isFile ? "file" : "logs",
				ok: !isFailed,
				source: isFile ? `read_file(repo/file-${i}.txt)` : `cmd-${i}`,
				preview: `preview output for call ${i}`,
				error: isFailed ? "command failed" : undefined,
			},
		});
	}
	return events;
}

function makeSteps(
	all: RunStep[],
	open: ReadonlySet<number> = new Set<number>(),
	onToggle: (n: number) => void = () => {},
): TranscriptSteps {
	return {
		all,
		open,
		onToggle,
		highlight: null,
		flagged: new Set<number>(),
	};
}

describe("Transcript render probe (#874)", () => {
	it("renders identical props without re-rendering rows or transcript", async () => {
		const events = makeToolStepEvents(3);
		const items = deriveTranscript(events);
		const stepsAll = deriveSteps(events);
		const steps = makeSteps(stepsAll);

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps}
				/>,
			);
		});

		const initialCounts = window.__renderProbe?.counts();
		expect(initialCounts?.Transcript).toBe(1);
		expect(initialCounts?.TranscriptRow).toBeGreaterThan(0);

		window.__renderProbe?.reset();

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps}
				/>,
			);
		});

		const counts = window.__renderProbe?.counts() ?? {};
		expect(counts.Transcript).toBeUndefined();
		expect(counts.TranscriptRow).toBeUndefined();
	});

	it("renders only affected row and StepGroup when new tool result arrives", async () => {
		const events = makeToolStepEvents(20);
		// Remove the last tool_result so the 20th call has no result yet
		const pendingEvents = events.slice(0, -1);
		const previousItems = deriveTranscript(pendingEvents, {
			run: { status: "running", live: true },
		});
		const previousSteps = deriveSteps(pendingEvents);
		const onToggle = () => {};
		const stepsObj = makeSteps(previousSteps, new Set(), onToggle);

		await act(async () => {
			root.render(
				<Transcript
					items={previousItems}
					incidentId="inc-1"
					agent="Claude Code"
					steps={stepsObj}
				/>,
			);
		});

		window.__renderProbe?.reset();

		const nextItems = deriveTranscript(events, {
			run: { status: "running", live: true },
		});
		const sharedItems = shareItems(previousItems, nextItems);
		const nextSteps = deriveSteps(events);
		const sharedSteps = replaceEqualDeep(previousSteps, nextSteps);
		const nextStepsObj = makeSteps(sharedSteps, stepsObj.open, onToggle);

		await act(async () => {
			root.render(
				<Transcript
					items={sharedItems}
					incidentId="inc-1"
					agent="Claude Code"
					steps={nextStepsObj}
				/>,
			);
		});

		const counts = window.__renderProbe?.counts() ?? {};
		expect(counts.TranscriptRow ?? 0).toBeLessThanOrEqual(2);
		expect(counts.StepGroup ?? 0).toBeLessThanOrEqual(1);
	});

	it("updates Thinking leaf on clock ticks without re-rendering rows", async () => {
		vi.useFakeTimers();
		const now = new Date("2026-10-21T12:00:00Z").getTime();
		vi.setSystemTime(now);

		const since = new Date(now - 5000).toISOString();
		const items: TranscriptItem[] = [
			{ kind: "thinking", key: "thinking", since },
		];
		const steps = makeSteps([]);

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps}
				/>,
			);
		});

		const thinkingEl = container.querySelector(
			'[data-testid="transcript-thinking"]',
		);
		expect(thinkingEl?.textContent).toContain("Thinking");
		expect(thinkingEl?.textContent).toContain("for 5s");
		expect(thinkingEl?.classList.contains("text-warn")).toBe(false);

		window.__renderProbe?.reset();

		await act(async () => {
			vi.advanceTimersByTime(3000);
		});

		expect(thinkingEl?.textContent).toContain("for 8s");
		const counts = window.__renderProbe?.counts() ?? {};
		expect(counts.TranscriptRow ?? 0).toBe(0);
		expect(counts.ThinkingLine ?? 0).toBeGreaterThanOrEqual(1);

		// With since 120s back it reads Quiet for 2m and has class text-warn
		const staleSince = new Date(Date.now() - 120000).toISOString();
		const staleItems: TranscriptItem[] = [
			{ kind: "thinking", key: "thinking", since: staleSince },
		];

		await act(async () => {
			root.render(
				<Transcript
					items={staleItems}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps}
				/>,
			);
		});

		const staleEl = container.querySelector(
			'[data-testid="transcript-thinking"]',
		);
		expect(staleEl?.textContent).toContain("Quiet");
		expect(staleEl?.textContent).toContain(`for ${formatElapsed(120)}`);
		expect(staleEl?.classList.contains("text-warn")).toBe(true);
	});

	it("re-renders only the StepGroup holding the toggled step", async () => {
		const events = makeToolStepEvents(5);
		const items = deriveTranscript(events);
		const stepsAll = deriveSteps(events);

		let openSet = new Set<number>();
		const onToggle = (n: number) => {
			openSet = new Set([n]);
		};

		const steps1 = makeSteps(stepsAll, openSet, onToggle);

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps1}
				/>,
			);
		});

		window.__renderProbe?.reset();

		// Toggle step 2 open
		const steps2 = makeSteps(stepsAll, new Set([2]), onToggle);

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps2}
				/>,
			);
		});

		const counts = window.__renderProbe?.counts() ?? {};
		expect(counts.StepGroup).toBe(1);
	});
});
