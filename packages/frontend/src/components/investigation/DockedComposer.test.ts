// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The box's chips change only the run they sit on (#673 w52): a draft keeps
 * its own choice, a run's chip opens a draft of that run plus the change, and
 * Settings is never written from here.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
			level: { level: "auto", from: "agent" },
		}),
		modelName: (_h: unknown, id: string) => id,
		unreadyReason: () => null,
		useAgentChoice: () => ({
			harnesses: [h.opencode, h.codex],
			effective: h.opencode,
			model: "vendor/a",
			models: { opencode: "vendor/a", codex: "gpt-x" },
			efforts: { opencode: "low" },
			axes: { accessLevels: {}, autoAccessLevels: {} },
		}),
	};
});
vi.mock("@/lib/api/hooks", () => ({
	useUpdateHarnessSettings: () => ({ mutate: h.mutate }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
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
const q = (testId: string) =>
	container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
const click = (testId: string) => act(async () => q(testId).click());

function setRecord(over: Record<string, unknown>) {
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
			sendMessage: vi.fn(),
			stop: vi.fn(),
			waiting: 0,
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

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	h.mutate.mockReset();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("DockedComposer chips (#673 w52)", () => {
	it("on a draft, keeps every change in the draft and never writes Settings", async () => {
		setRecord({ draft: true });
		await render();
		expect(q("effort").dataset.value).toBe("low");
		await click("pick-effort");
		await click("pick-mode");
		await click("pick-model");
		await click("pick-agent");
		const set = h.record.setDraftChoice as ReturnType<typeof vi.fn>;
		expect(set.mock.calls.map((c) => c[0])).toEqual([
			{ harness: "opencode", model: "vendor/a", effort: "high", accessLevel: "auto" },
			{ harness: "opencode", model: "vendor/a", effort: "low", accessLevel: "full-access" },
			{ harness: "opencode", model: "vendor/b", effort: "low", accessLevel: "auto" },
			// Another agent starts from its own Settings for effort and level.
			{ harness: "codex", model: "" },
		]);
		expect(h.mutate).not.toHaveBeenCalled();
	});

	it("on a finished run, opens a draft of that run plus the change, and never writes Settings", async () => {
		setRecord({});
		await render();
		await click("pick-effort");
		await click("pick-mode");
		const newRun = h.record.newRun as ReturnType<typeof vi.fn>;
		expect(newRun.mock.calls.map((c) => c[0])).toEqual([
			{ choice: { harness: "opencode", model: "vendor/run", effort: "high", accessLevel: "auto-edits" } },
			{ choice: { harness: "opencode", model: "vendor/run", effort: "medium", accessLevel: "full-access" } },
		]);
		expect(h.mutate).not.toHaveBeenCalled();
	});

	it("sends the draft's own choice with the run, and nothing when it has none", async () => {
		setRecord({
			draft: true,
			draftText: "look",
			draftChoice: { harness: "codex", model: "", effort: null, accessLevel: "full-access" },
		});
		await render();
		expect(q("mode").dataset.value).toBe("full-access");
		await click("composer-send");
		expect(h.record.investigate).toHaveBeenCalledWith(
			expect.objectContaining({ harness: "codex", model: "", effort: null, accessLevel: "full-access" }),
		);

		await act(async () => root.unmount());
		root = createRoot(container);
		setRecord({ draft: true, draftText: "look" });
		await render();
		await click("composer-send");
		const [start] = (h.record.investigate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(start).not.toHaveProperty("harness");
		expect(start).not.toHaveProperty("model");
		expect(start).not.toHaveProperty("effort");
	});
});
