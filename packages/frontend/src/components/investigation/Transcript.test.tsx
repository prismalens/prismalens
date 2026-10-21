// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatElapsed } from "@/lib/format-time";
import type { TranscriptItem } from "@/lib/investigation-events";
import type { AskRecord } from "@/lib/run-asks";
import { Transcript } from "./Transcript";

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

describe("Worked fold", () => {
	const reportData = {
		title: "Investigation Report",
		summary: "All systems recovered",
	};

	const items: TranscriptItem[] = [
		{
			kind: "operator",
			key: "brief",
			at: "2026-10-21T10:00:00Z",
			state: "started",
			mode: "now",
			text: "Investigate outage",
			attachments: [],
		},
		{
			kind: "prose",
			key: "p1",
			text: "Checking logs...",
		},
		{
			kind: "line",
			key: "l1",
			text: "Querying service status",
		},
		{
			kind: "end",
			key: "end",
			report: true,
		},
	];

	it("renders closed toggle with elapsed time, steps count, and hides middle items", async () => {
		const onToggle = vi.fn();
		const seconds = 252;
		const steps = 23;

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					report={reportData}
					worked={{ seconds, steps, open: false, onToggle }}
				/>,
			);
		});

		const toggle = container.querySelector('[data-testid="worked-toggle"]');
		expect(toggle).not.toBeNull();
		expect(toggle?.textContent).toBe(
			`Worked for ${formatElapsed(seconds)}, ${steps} steps`,
		);
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");

		expect(
			container.querySelector('[data-testid="transcript-operator"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-report"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-prose"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-line"]'),
		).toBeNull();
	});

	it("renders items when open and calls onToggle on click", async () => {
		const onToggle = vi.fn();

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					report={reportData}
					worked={{ seconds: 252, steps: 23, open: true, onToggle }}
				/>,
			);
		});

		const toggle = container.querySelector(
			'[data-testid="worked-toggle"]',
		) as HTMLButtonElement | null;
		expect(toggle).not.toBeNull();
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");

		expect(
			container.querySelector('[data-testid="transcript-operator"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-prose"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-line"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-report"]'),
		).not.toBeNull();

		await act(async () => {
			toggle?.click();
		});

		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it("formats singular step when steps is 1", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					report={reportData}
					worked={{ seconds: 5, steps: 1, open: false, onToggle: () => {} }}
				/>,
			);
		});

		const toggle = container.querySelector('[data-testid="worked-toggle"]');
		expect(toggle?.textContent).toBe("Worked for 5s, 1 step");
	});

	it("renders no toggle and every item when worked is null", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					report={reportData}
					worked={null}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="worked-toggle"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-operator"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-prose"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-line"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-report"]'),
		).not.toBeNull();
	});

	it("renders afterReport immediately after report card and omits it when report is null", async () => {
		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					report={reportData}
					afterReport={<li data-testid="after">hypotheses</li>}
				/>,
			);
		});

		const reportCard = container.querySelector(
			'[data-testid="transcript-report"]',
		);
		const after = container.querySelector('[data-testid="after"]');
		expect(reportCard).not.toBeNull();
		expect(after).not.toBeNull();
		expect(reportCard?.nextElementSibling).toBe(after);

		await act(async () => {
			root.render(
				<Transcript
					items={items}
					incidentId="inc-1"
					agent="Claude Code"
					report={null}
					afterReport={<li data-testid="after">hypotheses</li>}
				/>,
			);
		});

		expect(container.querySelector('[data-testid="after"]')).toBeNull();
	});
});
