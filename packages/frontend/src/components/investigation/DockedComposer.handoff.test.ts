// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HandoffPreview } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockedComposer } from "./DockedComposer";

interface PreviewState {
	data?: HandoffPreview;
	isPending: boolean;
	isError: boolean;
}

const h = vi.hoisted(() => {
	const agent = (id: string, label: string) => ({
		id,
		label,
		installed: true,
		checked: null,
	});
	return {
		mutate: vi.fn(),
		record: {} as Record<string, unknown>,
		settingsLevel: "auto",
		opencode: agent("opencode", "OpenCode"),
		codex: agent("codex", "Codex"),
		preview: {
			data: undefined,
			isPending: false,
			isError: false,
		} as PreviewState,
	};
});

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/agent/AgentPicker", async () => {
	const { createElement: el } = await import("react");
	const button = (testId: string, onClick: () => void) =>
		el("button", { type: "button", "data-testid": testId, onClick });
	return {
		CHIP: "chip",
		ModelChip: (p: { onPick: (a: unknown, m: string) => void }) =>
			el(
				"span",
				null,
				button("pick-model", () => p.onPick(h.opencode, "vendor/b")),
				button("pick-agent", () => p.onPick(h.codex, "")),
			),
		EffortChip: (p: { onEffort: (e: string) => void; effort: string | null }) =>
			el(
				"span",
				{ "data-testid": "effort", "data-value": p.effort ?? "" },
				button("pick-effort", () => p.onEffort("high")),
			),
		AccessChip: (p: { onLevel: (l: string) => void; level: string }) =>
			el(
				"span",
				{ "data-testid": "mode", "data-value": p.level },
				button("pick-mode", () => p.onLevel("full-access")),
			),
		defaultAccessOf: () => ({
			level: { level: h.settingsLevel, from: "agent" },
		}),
		modelName: (_h: unknown, id: string) => id,
		unreadyLine: () => null,
		useAgentChoice: () => ({
			harnesses: [h.opencode, h.codex],
			effective: h.opencode,
			model: "vendor/a",
			models: { opencode: "vendor/a", codex: "gpt-x" },
			efforts: { opencode: "low" },
			axes: { accessLevels: {} },
		}),
	};
});
vi.mock("@/lib/api/hooks", () => ({
	useUpdateHarnessSettings: () => ({ mutate: h.mutate }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: () => h.preview,
}));
vi.mock("@/lib/api/orpc-client", () => ({
	orpc: { investigations: { handoff: { queryOptions: () => ({}) } } },
}));
vi.mock("@/components/incidents/record-context", () => ({
	useIncidentRecord: () => h.record,
}));
vi.mock("@/components/incidents/run-facts", () => ({
	useRunAgentModel: () => ({ agent: "OpenCode", model: "m" }),
	runEffort: () => null,
	runNumber: () => 1,
	runElapsed: () => 0,
	runTimed: () => false,
	modelSource: () => "the agent's own",
	runAccessLine: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const q = <T extends HTMLElement = HTMLElement>(testId: string) =>
	container.querySelector(`[data-testid="${testId}"]`) as T;

function setRecord(over: Record<string, unknown> = {}) {
	h.record = {
		run: {
			state: over.draft ? null : "completed",
			events: [],
			pending: [],
			investigation: over.draft
				? null
				: {
						id: "inv-1",
						harness: "opencode",
						model: "vendor/run",
						effort: "medium",
						agentMode: "build",
						accessLevel: "auto-edits",
						report: { title: "Found root cause" },
					},
			sendMessage: vi.fn(),
			stop: vi.fn(),
			waiting: 0,
			queued: [],
			asks: [],
			steps: [],
			awaiting: false,
			stopRequested: false,
			continuable: false,
			resumable: true,
			undeliverable: null,
			clearUndeliverable: vi.fn(),
		},
		draft: false,
		draftChoice: {},
		setDraftChoice: vi.fn(),
		draftText: "",
		setDraftText: vi.fn(),
		runs: [],
		liveRun: null,
		incident: { id: "inc-1", alertCount: 1 },
		isStarting: false,
		investigate: vi.fn(),
		chat: vi.fn(),
		newRun: vi.fn(),
		addNote: vi.fn(),
		...over,
	};
}

async function render() {
	await act(async () => root.render(createElement(DockedComposer, {})));
}

async function type(text: string) {
	const field = q<HTMLTextAreaElement>("composer-input");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(field, text);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	h.mutate.mockReset();
	h.settingsLevel = "auto";
	h.preview = {
		data: undefined,
		isPending: false,
		isError: false,
	};
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("DockedComposer handoff states on a finished run", () => {
	it("handoff-L5: data -> composer-hint holds handoffHint where then what", async () => {
		h.preview = {
			data: {
				route: "handoff",
				harness: "opencode",
				carried: "alert and 3 messages",
				omitted: "10 tool calls",
				accessLevel: "auto-edits",
				preflight: null,
				note: null,
			},
			isPending: false,
			isError: false,
		};
		setRecord();
		await render();

		const hint = q("composer-hint");
		expect(hint).not.toBeNull();
		const spans = hint.querySelectorAll("span");
		expect(spans).toHaveLength(2);
		expect(spans[0]?.textContent).toBe(
			"Continues in a fresh OpenCode session, at Auto-accept edits.",
		);
		expect(spans[1]?.textContent).toBe(
			" OpenCode gets alert and 3 messages. 10 tool calls stay in the transcript file, which OpenCode can read.",
		);
	});

	it("handoff-L5: preview.isPending -> hint Checking what <agent> can take and Send disabled", async () => {
		h.preview = {
			data: undefined,
			isPending: true,
			isError: false,
		};
		setRecord();
		await render();

		const hint = q("composer-hint");
		expect(hint).not.toBeNull();
		expect(hint.textContent).toBe(
			"Checking what OpenCode can take from this run.",
		);

		const sendBtn = q<HTMLButtonElement>("composer-send");
		expect(sendBtn.disabled).toBe(true);

		await type("some text");
		expect(sendBtn.disabled).toBe(true);
	});

	it("handoff-L5: data with preflight -> composer-blocked shows problem and fix, Send disabled, input not disabled", async () => {
		h.preview = {
			data: {
				route: "handoff",
				harness: "opencode",
				carried: "alert and report",
				omitted: null,
				accessLevel: "auto-edits",
				preflight: {
					problem: "Agent is not available.",
					fix: "Install the agent or choose another.",
				},
				note: null,
			},
			isPending: false,
			isError: false,
		};
		setRecord();
		await render();

		const blocked = q("composer-blocked");
		expect(blocked).not.toBeNull();
		expect(blocked.textContent).toBe(
			"Agent is not available. Install the agent or choose another.",
		);

		const input = q<HTMLTextAreaElement>("composer-input");
		expect(input.disabled).toBe(false);

		const sendBtn = q<HTMLButtonElement>("composer-send");
		expect(sendBtn.disabled).toBe(true);

		await type("trying to send");
		expect(sendBtn.disabled).toBe(true);
	});

	it("handoff-L5: preview.isError -> composer-blocked shows error notice and Send is enabled once text typed", async () => {
		h.preview = {
			data: undefined,
			isPending: false,
			isError: true,
		};
		setRecord();
		await render();

		const blocked = q("composer-blocked");
		expect(blocked).not.toBeNull();
		expect(blocked.textContent).toBe(
			"Unable to check what OpenCode will get. Sending still works.",
		);

		const sendBtn = q<HTMLButtonElement>("composer-send");
		expect(sendBtn.disabled).toBe(true);

		await type("hello agent");
		expect(sendBtn.disabled).toBe(false);
	});

	it("handoff-L5: preview.data.note set -> composer-restart-note exists", async () => {
		h.preview = {
			data: {
				route: "handoff",
				harness: "opencode",
				carried: "alert",
				omitted: null,
				accessLevel: "auto-edits",
				preflight: null,
				note: "restarted-earlier",
			},
			isPending: false,
			isError: false,
		};
		setRecord();
		await render();

		const note = q("composer-restart-note");
		expect(note).not.toBeNull();
		expect(note.textContent).toBe(
			"PrismaLens restarted while the previous session was working. Its last command may or may not have completed; check before relying on it.",
		);
	});
});
