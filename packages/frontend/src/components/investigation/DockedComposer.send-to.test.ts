// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ACCESS_LEVEL_LABEL } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEditorKit } from "@/components/thread/composer/editor/load-kit";
import { settleEditor, typeIn } from "../thread/composer/editor/test-helpers";
import { DockedComposer } from "./DockedComposer";

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
		sendMessage: vi.fn(),
		settingsLevel: "auto",
		opencode: agent("opencode", "OpenCode"),
		codex: agent("codex", "Codex"),
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
		effortLevels: () => [{ id: "low", name: "Low", default: true }],
		EffortChip: (p: { onEffort: (e: string) => void; effort: string | null }) =>
			el(
				"span",
				{ "data-testid": "effort", "data-value": p.effort ?? "" },
				button("pick-effort", () => p.onEffort("high")),
			),
		ModeChip: (p: {
			onPick: (n: { accessLevel?: string; agentMode: string | null }) => void;
			level: string;
			lockedHint?: string;
		}) =>
			el(
				"span",
				{
					"data-testid": "mode",
					"data-value": p.level,
					"data-hint": p.lockedHint,
				},
				button("pick-mode", () =>
					p.onPick({ accessLevel: "full-access", agentMode: null }),
				),
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
	useQuery: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/orpc-client", () => {
	const dummy = { queryOptions: () => ({}), mutationOptions: () => ({}) };
	return {
		orpc: {
			investigations: { handoff: dummy, compact: dummy },
			references: { search: dummy, use: dummy, resolve: dummy },
			drafts: { get: dummy, put: dummy, delete: dummy, attachments: dummy },
		},
	};
});
vi.mock("@/lib/api/hooks/use-references-orpc", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api/hooks/use-references-orpc")>();
	return {
		...actual,
		useReferenceSearch: () => ({ data: undefined, isFetching: false, error: null }),
		useReferenceUse: () => ({ mutate: vi.fn() }),
		useResolveLinks: () => ({ mutate: vi.fn() }),
	};
});
vi.mock("@/lib/api/hooks/use-drafts-orpc", () => ({
	useServerDraft: () => ({ data: undefined, isPending: false, isLoading: false }),
	useSaveDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
	useDeleteDraft: () => ({ mutate: vi.fn() }),
	useDraftAttachments: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useCompactThread: () => ({ mutate: vi.fn() }),
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
const q = <T extends Element = HTMLElement>(testId: string) =>
	container.querySelector(`[data-testid="${testId}"]`) as T;
const click = (testId: string) => act(async () => q(testId).click());

async function type(text: string) {
	const field = q("composer-input");
	await typeIn(field, text);
}

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
					},
			sendMessage: h.sendMessage,
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
	await settleEditor();
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	h.mutate.mockReset();
	h.sendMessage.mockReset();
	h.settingsLevel = "auto";
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

// The editor's code loads after the box paints (#1101 category 12); these tests start with it loaded.
beforeAll(() => loadEditorKit());

describe("DockedComposer send-to handoff (#849)", () => {
	it("handoff-L6: setRecord({}), click pick-agent, type text, Send: calls sendMessage with to and placeholder becomes Message Codex", async () => {
		setRecord({});
		await render();

		await click("pick-agent");
		const input = q("composer-input");
		expect(input.getAttribute("aria-label")).toBe("Message Codex");

		await type("check memory leak");
		await click("composer-send");

		expect(h.record.newRun).not.toHaveBeenCalled();
		expect(h.sendMessage).toHaveBeenCalledWith(
			"check memory leak",
			"queue",
			expect.objectContaining({
				to: { harness: "codex", model: null },
			}),
		);
	});

	it("handoff-L6: without pick, Send does not include to key in options", async () => {
		setRecord({});
		await render();

		await type("status update");
		await click("composer-send");

		expect(h.record.newRun).not.toHaveBeenCalled();
		expect(h.sendMessage).toHaveBeenCalledTimes(1);
		const [, , options] = h.sendMessage.mock.calls[0] as [
			string,
			string,
			Record<string, unknown>,
		];
		expect(options).not.toHaveProperty("to");
	});

	it("handoff-L6: access chip exposes lockedHint with run's permission label on a finished run", async () => {
		setRecord({});
		await render();

		const mode = q("mode");
		const expectedLabel = ACCESS_LEVEL_LABEL["auto-edits"];
		expect(mode.getAttribute("data-hint")).toBe(
			`A follow-up keeps the run's permission, ${expectedLabel}. Start a new run to change it.`,
		);
	});
});
