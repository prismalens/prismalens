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
import { DockedComposer, runFollowUpLevel, threadActions } from "./DockedComposer";

type FollowUpRun = Parameters<typeof runFollowUpLevel>[0];

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
	useQuery: () => ({ data: undefined }),
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

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	h.mutate.mockReset();
	h.settingsLevel = "auto";
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

	it("on a finished run, a pick stays with the follow-up: no draft, no level change, never Settings (rulings 2, 3)", async () => {
		setRecord({});
		await render();
		await click("pick-effort");
		await click("pick-mode");
		expect(h.record.newRun).not.toHaveBeenCalled();
		expect(q("effort").dataset.value).toBe("high");
		expect(q("mode").dataset.value).toBe("auto-edits");
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

describe("the follow-up chip on an alert-started run (#673 w6-13)", () => {
	const alertRun = (state: string) => ({
		...(h.record.run as Record<string, unknown>),
		state,
		investigation: {
			id: "inv-1",
			harness: "opencode",
			model: "vendor/run",
			effort: "medium",
			agentMode: "build",
			accessLevel: "auto",
			triggerType: "auto_critical",
		},
	});

	it("shows the Settings level once the run has ended", async () => {
		h.settingsLevel = "supervised";
		setRecord({});
		h.record.run = alertRun("done");
		await render();
		expect(q("mode").dataset.value).toBe("supervised");
	});

	it("shows the run's own Auto while it runs", async () => {
		h.settingsLevel = "supervised";
		setRecord({});
		h.record.run = alertRun("working");
		await render();
		expect(q("mode").dataset.value).toBe("auto");
	});
});

describe("threadActions and runFollowUpLevel", () => {
	it("live: one action; placeholder \"Message the agent\"; its hint \"Reaches the agent at its next pause.\"", () => {
		const res = threadActions({
			draft: false,
			live: true,
			chat: false,
			continuable: false,
			reported: false,
			name: "Run 1",
			nextName: "Run 2",
			agent: "Claude Code",
			defaultDraft: "investigate",
		});
		expect(res.actions).toHaveLength(1);
		expect(res.placeholder).toBe("Message the agent");
		expect(res.hint[res.actions[0].id]).toBe("Reaches the agent at its next pause.");
	});

	it("finished and continuable, agent \"Claude Code\": one action, id \"continue\"; placeholder \"Message Claude Code\"; hint \"Continues in Claude Code's own session and ends in a report on the overview.\"", () => {
		const res = threadActions({
			draft: false,
			live: false,
			chat: false,
			continuable: true,
			reported: false,
			name: "Run 1",
			nextName: "Run 2",
			agent: "Claude Code",
			defaultDraft: "investigate",
		});
		expect(res.actions).toHaveLength(1);
		expect(res.actions[0].id).toBe("continue");
		expect(res.placeholder).toBe("Message Claude Code");
		expect(res.hint.continue).toBe(
			"Continues in Claude Code's own session and ends in a report on the overview.",
		);
	});

	it("finished, reported, not continuable: one action, id \"follow-up\"; no action with id \"recheck\"; placeholder \"Message Claude Code\"; hint \"Continues in Claude Code's own session.\"", () => {
		const res = threadActions({
			draft: false,
			live: false,
			chat: false,
			continuable: false,
			reported: true,
			name: "Run 1",
			nextName: "Run 2",
			agent: "Claude Code",
			defaultDraft: "investigate",
		});
		expect(res.actions).toHaveLength(1);
		expect(res.actions[0].id).toBe("follow-up");
		expect(res.actions.some((a) => a.id === "recheck")).toBe(false);
		expect(res.placeholder).toBe("Message Claude Code");
		expect(res.hint["follow-up"]).toBe("Continues in Claude Code's own session.");
	});

	it("draft: two actions, ask and investigate", () => {
		const res = threadActions({
			draft: true,
			live: false,
			chat: false,
			continuable: false,
			reported: false,
			name: "Run 1",
			nextName: "Run 2",
			agent: "Claude Code",
			defaultDraft: "ask",
		});
		expect(res.actions).toHaveLength(2);
		expect(res.actions.map((a) => a.id)).toEqual(["ask", "investigate"]);
	});

	it("runFollowUpLevel: returns settings level for ended run started by PrismaLens", () => {
		const inv = {
			triggerType: "auto_critical",
			accessLevel: "auto" as const,
		};
		expect(runFollowUpLevel(inv as unknown as FollowUpRun, "supervised", false)).toBe("supervised");
	});

	it("runFollowUpLevel: returns full-access for a run with accessLevel: \"full-access\"", () => {
		const inv = {
			triggerType: "manual",
			accessLevel: "full-access" as const,
		};
		expect(runFollowUpLevel(inv as unknown as FollowUpRun, "supervised", false)).toBe("full-access");
	});

	it("runFollowUpLevel: returns its own level for alert-started run while live", () => {
		const inv = {
			triggerType: "auto_critical",
			accessLevel: "auto" as const,
		};
		expect(runFollowUpLevel(inv as unknown as FollowUpRun, "supervised", true)).toBe("auto");
	});

	it("runFollowUpLevel: returns supervised for run with neither level nor report fidelity", () => {
		const inv = {
			triggerType: "manual",
		};
		expect(runFollowUpLevel(inv as unknown as FollowUpRun, "full-access", false)).toBe("supervised");
	});
});
