// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
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
	// The app root provides tooltips; the response row's hints need one here too.
	const inner = createRoot(container);
	root = {
		render: (node) => inner.render(<TooltipProvider>{node}</TooltipProvider>),
		unmount: () => inner.unmount(),
	} as Root;
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
		const folded = container.querySelector('[data-testid="tools-expand"]');
		expect(folded?.textContent).toContain("1 denied by you");
		expect(folded?.textContent).not.toContain("failed");
		await act(async () => {
			(folded as HTMLButtonElement).click();
		});
		expect(
			container.querySelector('[data-testid="step-verb"]')?.textContent,
		).toBe("Denied by you");
	});
});

describe("a tool group", () => {
	it("folds to one quiet line that opens to its steps", async () => {
		const step = {
			n: 1,
			callId: "c1",
			title: "git log",
			command: "git log --oneline -5",
			kind: "command" as const,
			verb: "Ran",
			ok: true,
			unfinished: false,
			output: "",
			at: "2026-10-13T04:30:00Z",
			took: 1,
			input: null,
		};
		await act(async () => {
			root.render(
				<Transcript
					items={[
						{
							kind: "tools",
							key: "t",
							count: 1,
							summary: "ran 1 command",
							failed: 0,
							running: 0,
							rows: [],
							callIds: ["c1"],
						},
					]}
					incidentId="inc-1"
					agent="Claude Code"
					steps={{
						all: [step],
						open: new Set<number>(),
						onToggle: () => {},
						highlight: null,
						flagged: new Set<number>(),
						asks: [],
					}}
				/>,
			);
		});
		const folded = container.querySelector('[data-testid="tools-expand"]');
		expect(folded?.textContent).toBe("Ran 1 command");
		expect(container.querySelector('[data-testid="step-verb"]')).toBeNull();
		await act(async () => {
			(folded as HTMLButtonElement).click();
		});
		expect(container.querySelector('[data-testid="step-verb"]')).not.toBeNull();
	});
});

describe("the report card", () => {
	it("reads the stop, says no lasting fix yet and offers to ask for one", async () => {
		const asked = vi.fn();
		window.addEventListener("pl:compose", asked);
		await act(async () => {
			root.render(
				<Transcript
					items={[
						{
							kind: "end",
							key: "end",
							tone: "done",
							text: "Report ready",
							report: true,
						},
					]}
					incidentId={null}
					agent="Claude Code"
					report={{
						title: "Run 1 report",
						summary: "d37d888 dropped the index.",
						stop: { title: "Revert d37d888" },
						lasting: null,
					}}
				/>,
			);
		});
		expect(
			container.querySelector('[data-testid="report-stop"]')?.textContent,
		).toContain("Revert d37d888");
		expect(
			container.querySelector('[data-testid="report-lasting"]')?.textContent,
		).toContain("None named yet.");
		await act(async () => {
			(
				container.querySelector(
					'[data-testid="report-ask-lasting"]',
				) as HTMLButtonElement
			).click();
		});
		window.removeEventListener("pl:compose", asked);
		expect(asked).toHaveBeenCalledTimes(1);
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
			tone: "done",
			text: "Report ready",
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

describe("Transcript spine (#1020)", () => {
	const op = (
		key: string,
		state: "started" | "delivered" | "answered",
		at: string,
	): TranscriptItem => ({
		kind: "operator",
		key,
		text: key,
		at,
		state,
		mode: "queue",
		attachments: [],
	});

	it("prints Answered, marks unquoted evidence unverified and keeps a suspect's own word", async () => {
		const items: TranscriptItem[] = [
			op("brief", "started", "2026-11-03T10:00:00Z"),
			op("follow", "answered", "2026-11-03T10:01:00Z"),
			{
				kind: "finding",
				key: "f1",
				at: "2026-11-03T10:01:01Z",
				finding: {
					type: "evidence",
					id: "e1",
					observation: "<b>No backoff</b>",
					source: "retry.ts",
					quote: "q",
					direction: "supports",
					anchor: null,
					at: "x",
				},
			},
			{
				kind: "finding",
				key: "f2",
				at: "2026-11-03T10:01:02Z",
				finding: {
					type: "hypothesis",
					id: "h1",
					statement: "Retry storm",
					status: "speculative",
					evidenceIds: [],
					at: "x",
				},
			},
			{
				kind: "gateway",
				key: "g1",
				node: "knowledge",
				name: "pl_incidents_similar",
				outcome: "INC-7 retry storm",
				failed: false,
				at: "x",
			},
		];
		await act(async () =>
			root.render(<Transcript items={items} incidentId={null} agent="Agent" />),
		);
		const delivery = container.querySelectorAll(
			'[data-testid="transcript-delivery"]',
		);
		expect(delivery[1]?.textContent).toBe("answered");
		const evidence = container.querySelector('[data-type="evidence"]');
		expect(
			evidence?.querySelector('[data-testid="finding-unverified"]')
				?.textContent,
		).toBe("Unverified");
		// Agent text is plain text, never markup.
		expect(evidence?.textContent).toContain("<b>No backoff</b>");
		expect(evidence?.querySelector("b")).toBeNull();
		expect(
			container.querySelector('[data-testid="finding-status"]')?.textContent,
		).toBe("Speculative");
		expect(container.textContent).not.toMatch(/leading/i);
		expect(
			container.querySelector('[data-testid="transcript-gateway"]')
				?.textContent,
		).toContain("INC-7 retry storm");
		expect(
			container.querySelector('[data-testid="transcript-gateway"]')
				?.textContent,
		).toContain("Searched for similar incidents");
	});

	it("draws a steered message's delivery as the arrow mark, a queued one as words (#1101)", async () => {
		const items: TranscriptItem[] = [
			{ ...op("queued", "delivered", "2026-11-03T10:00:00Z") },
			{ ...op("steered", "delivered", "2026-11-03T10:01:00Z"), mode: "now" },
		];
		await act(async () =>
			root.render(<Transcript items={items} incidentId={null} agent="Agent" />),
		);
		const rows = container.querySelectorAll(
			'[data-testid="transcript-operator"]',
		);
		expect(
			rows[0]?.querySelector('[data-testid="transcript-delivery"]')
				?.textContent,
		).toBe("delivered at the next pause");
		expect(
			rows[0]?.querySelector('[data-testid="transcript-steered"]'),
		).toBeNull();
		expect(
			rows[1]
				?.querySelector('[data-testid="transcript-steered"]')
				?.getAttribute("aria-label"),
		).toBe("Delivery: Steered: sent now, stopping the agent's step");
		expect(
			rows[1]?.querySelector('[data-testid="transcript-delivery"]'),
		).toBeNull();
	});

	it("never calls a chat's first message a brief", async () => {
		const items = [op("hi", "started", "2026-11-03T10:00:00Z")];
		await act(async () =>
			root.render(
				<Transcript
					items={items}
					incidentId={null}
					agent="Agent"
					runName="Hi"
					chat
				/>,
			),
		);
		const line = container.querySelector('[data-testid="transcript-delivery"]');
		expect(line?.textContent).toBe("sent");
		expect(container.textContent).not.toMatch(/brief/i);
		await act(async () =>
			root.render(
				<Transcript
					items={items}
					incidentId={null}
					agent="Agent"
					runName="Run 2"
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="transcript-delivery"]')
				?.textContent,
		).toBe("brief for Run 2");
	});

	it("folds a finished turn behind Worked for, and the chevron opens it", async () => {
		const items: TranscriptItem[] = [
			op("brief", "started", "2026-11-03T10:00:00Z"),
			{
				kind: "tools",
				key: "t1",
				count: 1,
				summary: "ran 1 command",
				failed: 0,
				running: 0,
				rows: [],
				callIds: [],
				at: "2026-11-03T10:00:10Z",
				until: "2026-11-03T10:03:00Z",
			},
			{
				kind: "prose",
				key: "p1",
				text: "The answer",
				at: "2026-11-03T10:04:00Z",
			},
		];
		await act(async () =>
			root.render(
				<Transcript
					items={items}
					incidentId={null}
					agent="Agent"
					foldTurns={{ live: false }}
				/>,
			),
		);
		const fold = container.querySelector<HTMLButtonElement>(
			'[data-testid="turn-fold"]',
		);
		expect(fold?.textContent).toBe(`Worked for ${formatElapsed(240)}`);
		expect(
			container.querySelector('[data-testid="transcript-tools"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="transcript-prose"]')?.textContent,
		).toContain("The answer");
		await act(async () => fold?.click());
		expect(fold?.getAttribute("aria-expanded")).toBe("true");
		expect(
			container.querySelector('[data-testid="transcript-tools"]'),
		).not.toBeNull();
	});

	it("renders a long tools group of 12 steps with steps.open = {12} and flagged = {6}: step 6 is rendered, steps 4,5 and 7..9 are folded behind two buttons (#1101)", async () => {
		const stepsAll = Array.from({ length: 12 }, (_, i) => ({
			n: i + 1,
			callId: `call-${i + 1}`,
			title: `command-${i + 1}`,
			command: `echo ${i + 1}`,
			kind: "command" as const,
			verb: "Ran",
			ok: true,
			unfinished: false,
			output: `output-${i + 1}`,
			at: "2026-11-03T10:00:00Z",
			took: 1,
			input: null,
		}));

		const item: TranscriptItem = {
			kind: "tools",
			key: "tools-long",
			count: 12,
			summary: "ran 12 commands",
			failed: 0,
			running: 0,
			rows: [],
			callIds: stepsAll.map((s) => s.callId),
		};

		await act(async () =>
			root.render(
				<Transcript
					items={[item]}
					incidentId="inc-1"
					agent="Agent"
					steps={{
						all: stepsAll,
						open: new Set<number>([12]),
						onToggle: () => {},
						highlight: null,
						flagged: new Set<number>([6]),
						asks: [],
					}}
				/>,
			),
		);

		// Step 6 is flagged and should be rendered in the document
		const renderedSteps = Array.from(
			container.querySelectorAll('[data-testid="step"]'),
		);
		const renderedTitles = renderedSteps.map(
			(el) => el.querySelector('[data-testid="step-title"]')?.textContent,
		);
		expect(renderedTitles).toContain("echo 6");

		// Two unfold buttons should exist with the exact requested text
		const unfoldButtons = Array.from(
			container.querySelectorAll('[data-testid="steps-unfold"]'),
		).map((b) => b.textContent);

		expect(unfoldButtons).toEqual(["2 more", "3 more"]);
	});

	it("renders an edit-only finished turn with no turn-summary and turn-changes reading 'Changed 1 file' (#1101)", async () => {
		const opItem = op("brief", "started", "2026-11-03T10:00:00Z");
		const toolsItem: TranscriptItem = {
			kind: "tools",
			key: "turn-tools",
			count: 1,
			summary: "edited a.ts",
			failed: 0,
			running: 0,
			rows: [],
			callIds: ["c-edit"],
		};
		const proseItem: TranscriptItem = {
			kind: "prose",
			key: "p-done",
			text: "Turn finished successfully",
			at: "2026-11-03T10:02:00Z",
		};

		const editStep = {
			n: 1,
			callId: "c-edit",
			title: "edit a.ts",
			command: "edit a.ts",
			kind: "edit" as const,
			verb: "Edited",
			ok: true,
			unfinished: false,
			output: "",
			at: "2026-11-03T10:01:00Z",
			took: 1,
			input: null,
			node: "edit",
			path: "a.ts",
			edit: { path: "a.ts", add: 3, del: 1 },
		};

		await act(async () =>
			root.render(
				<Transcript
					items={[opItem, toolsItem, proseItem]}
					incidentId="inc-1"
					agent="Agent"
					steps={{
						all: [editStep as never],
						open: new Set<number>(),
						onToggle: () => {},
						highlight: null,
						flagged: new Set<number>(),
						asks: [],
					}}
				/>,
			),
		);

		const summaryEl = container.querySelector('[data-testid="turn-summary"]');
		expect(summaryEl).toBeNull();

		const changesEl = container.querySelector('[data-testid="turn-changes"]');
		expect(changesEl).not.toBeNull();
		expect(changesEl?.textContent).toContain("Changed 1 file");
	});
});
