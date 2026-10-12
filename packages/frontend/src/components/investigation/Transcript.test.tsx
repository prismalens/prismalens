// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "@/lib/investigation-events";
import type { AskRecord } from "@/lib/run-asks";
import { Transcript } from "./Transcript";

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
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("Transcript asks (#820)", () => {
	const ask: AskRecord = {
		askId: "00000000-0000-0000-0000-000000000001",
		title: "rm -rf /tmp/test",
		detail: "/tmp/test",
		input: null,
		server: null,
		at: "2026-10-09T10:00:00Z",
		expiresAt: "2026-10-09T10:10:00Z",
		clamped: false,
		state: "timed_out",
	};
	const steps = (asks: AskRecord[]) => ({
		all: [],
		open: new Set<number>(),
		onToggle: () => {},
		highlight: null,
		flagged: new Set<number>(),
		asks,
	});
	const item: TranscriptItem = { kind: "ask", key: "a", askId: ask.askId };

	it("shows no card and no buttons: the ask answers in the dock", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={[item]}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps([{ ...ask, state: "waiting" }])}
				/>,
			);
		});
		expect(container.querySelector('[data-testid="ask-approve"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-ask"]')?.textContent,
		).toBe(
			"Claude Code asked to run rm -rf /tmp/test: waiting for your approval",
		);
	});

	it("keeps one line for an ask no step carries, saying how it ended", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={[item]}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps([{ ...ask, clamped: true }])}
				/>,
			);
		});
		expect(
			container.querySelector('[data-testid="transcript-ask"]')?.textContent,
		).toBe(
			"Claude Code asked to run rm -rf /tmp/test: denied: the run's time limit was reached",
		);
	});

	it("leaves the line to the step when a step carries the ask", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={[item]}
					incidentId="inc-1"
					agent="Claude Code"
					steps={steps([{ ...ask, step: 1 }])}
				/>,
			);
		});
		expect(
			container.querySelector('[data-testid="transcript-ask"]'),
		).toBeNull();
	});
});

describe("Transcript level lines (#673 w21)", () => {
	it("renders allowed and mode_kept lines with their respective testids", async () => {
		const levelItems: TranscriptItem[] = [
			{
				kind: "level",
				key: "lvl-1",
				outcome: "allowed",
				text: "Allowed at Ask always: A tool call",
			},
			{
				kind: "level",
				key: "lvl-3",
				outcome: "mode_kept",
				text: "Mode switch refused: Enter Plan Mode",
			},
		];

		await act(async () => {
			root.render(
				<Transcript
					items={levelItems}
					incidentId="inc-1"
					agent="Claude Code"
				/>,
			);
		});

		const allowed = container.querySelector(
			'[data-testid="transcript-allowed"]',
		);
		expect(allowed).not.toBeNull();
		expect(allowed?.textContent).toBe("Allowed at Ask always: A tool call");

		const modeKept = container.querySelector(
			'[data-testid="transcript-mode-kept"]',
		);
		expect(modeKept).not.toBeNull();
		expect(modeKept?.textContent).toBe("Mode switch refused: Enter Plan Mode");
	});
});

describe("Transcript report drafts (#673 w8-14)", () => {
	const draft = '{\n  "rootCause": null,\n  "nextSteps": []\n}';

	it("folds the draft under the answer, closed, instead of printing it", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={[{ kind: "prose", key: "p", text: "No cause yet.", draft }]}
					incidentId="inc-1"
					agent="Claude Code"
				/>,
			);
		});
		const fold = container.querySelector<HTMLDetailsElement>(
			'[data-testid="transcript-report-draft"]',
		);
		expect(fold?.open).toBe(false);
		expect(fold?.querySelector("summary")?.textContent).toBe(
			"Report draft as the agent wrote it",
		);
		expect(
			container.querySelector('[data-testid="transcript-prose"]')?.textContent,
		).not.toContain("rootCause");
	});
});

describe("a step you denied (#673 w8-18)", () => {
	it("reads Denied by you, not Failed", async () => {
		const denied: AskRecord = {
			askId: "a1",
			title: "docker ps",
			detail: "docker ps",
			input: null,
			server: null,
			at: "2026-10-13T04:30:00Z",
			expiresAt: "2026-10-13T04:40:00Z",
			clamped: false,
			state: "denied",
			step: 1,
		};
		await act(async () => {
			root.render(
				<Transcript
					items={[
						{
							kind: "tools",
							key: "t",
							count: 1,
							summary: "",
							failed: 1,
							running: 0,
							rows: [],
							callIds: ["c1"],
						},
					]}
					incidentId="inc-1"
					agent="Claude Code"
					steps={{
						all: [
							{
								n: 1,
								callId: "c1",
								title: "docker ps",
								command: "docker ps",
								kind: "command",
								verb: "Failed",
								ok: false,
								unfinished: false,
								output: "denied",
								at: "2026-10-13T04:30:00Z",
								took: 1,
								input: null,
							},
						],
						open: new Set<number>(),
						onToggle: () => {},
						highlight: null,
						flagged: new Set<number>(),
						asks: [denied],
					}}
				/>,
			);
		});
		expect(
			container.querySelector('[data-testid="step-verb"]')?.textContent,
		).toBe("Denied by you");
	});
});
