// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerBox } from "./ComposerBox";
import { DockedComposer, lastMessageWord } from "./DockedComposer";

const record = vi.hoisted(() => ({
	sendMessage: vi.fn(),
	/** Per-test changes to the run and the record (#673 w59). */
	run: {} as Record<string, unknown>,
	extra: {} as Record<string, unknown>,
}));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/agent/AgentPicker", () => ({
	ModelChip: () => null,
	CHIP: "chip",
	EffortChip: () => null,
	ModeChip: () => null,
	defaultModeOf: () => "agent-default",
	modelName: (_h: unknown, id: string) => id,
	unreadyReason: () => null,
	useAgentChoice: () => ({
		harnesses: [],
		effective: undefined,
		model: "",
		efforts: {},
		agentModes: {},
	}),
}));
vi.mock("@/lib/api/hooks", () => ({
	useUpdateHarnessSettings: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/incidents/record-context", () => ({
	useIncidentRecord: () => ({
		run: {
			state: "working",
			events: [],
			investigation: { id: "inv-1", harness: "opencode", agentMode: "plan", agentModeName: "Plan", liveTurn: "report" },
			sendMessage: record.sendMessage,
			stop: vi.fn(),
			waiting: 0,
			stopRequested: false,
			continuable: false,
			resumable: false,
			undeliverable: null,
			clearUndeliverable: vi.fn(),
			...record.run,
		},
		investigationId: "inv-1",
		draft: false,
		runs: [],
		liveRun: null,
		incident: { id: "inc-1", alertCount: 1 },
		isStarting: false,
		investigate: vi.fn(),
		chat: vi.fn(),
		newRun: vi.fn(),
		draftChoice: {},
		draftFiles: [],
		setDraftVerb: vi.fn(),
		addNote: vi.fn(),
		...record.extra,
	}),
}));
vi.mock("@/components/incidents/run-facts", () => ({
	useRunAgentModel: () => ({ agent: "OpenCode", model: "m" }),
	runEffort: () => null,
	runNumber: () => 1,
	runElapsed: () => 0,
	runTimed: () => false,
	modelSource: () => "the agent's own",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const q = <T extends Element>(testId: string) =>
	container.querySelector(`[data-testid="${testId}"]`) as T;

async function type(text: string) {
	const field = q<HTMLTextAreaElement>("composer-input");
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function attach(file: File) {
	const input = q<HTMLInputElement>("composer-file-input");
	Object.defineProperty(input, "files", { value: [file], configurable: true });
	await act(async () => {
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	record.sendMessage.mockReset();
	record.run = {};
	record.extra = {};
});

describe("ComposerBox image previews (R4.3)", () => {
	it("keeps a shown thumbnail's URL when another file is added, and revokes each on remove and unmount", async () => {
		let n = 0;
		vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++n}`);
		const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		await act(async () => {
			root.render(
				createElement(ComposerBox, {
					mode: "live",
					chips: null,
					text: "",
					setText: () => {},
					verbs: [],
					verb: "ask",
					placeholder: "Message the agent",
					onInvestigate: () => {},
					onAsk: () => {},
					onMessage: () => {},
					agent: { label: "OpenCode", images: true },
				}),
			);
		});

		await attach(new File(["a"], "one.png", { type: "image/png" }));
		await attach(new File(["b"], "two.png", { type: "image/png" }));
		expect(revoke).not.toHaveBeenCalled();

		await act(async () => {
			(container.querySelector('[aria-label="Remove one.png"]') as HTMLButtonElement).click();
		});
		expect(revoke.mock.calls).toEqual([["blob:1"]]);

		await act(async () => root.unmount());
		expect(revoke.mock.calls).toEqual([["blob:1"], ["blob:2"]]);
		root = createRoot(container);
	});
});

describe("the box: one send control, the verb chip where both verbs act (#673 w59, T22)", () => {
	const copy = { investigate: "Gathers…", ask: "A question to the agent. No report." };
	async function render(props: Record<string, unknown>) {
		const calls = { investigate: vi.fn(), ask: vi.fn(), message: vi.fn() };
		await act(async () => {
			root.render(
				createElement(ComposerBox, {
					mode: "draft",
					chips: null,
					text: "why the pool?",
					setText: () => {},
					verbs: [],
					verb: "ask",
					verbCopy: copy,
					onVerb: () => {},
					placeholder: "p",
					onInvestigate: calls.investigate,
					onAsk: calls.ask,
					onMessage: calls.message,
					agent: { label: "OpenCode", images: true },
					...props,
				} as Parameters<typeof ComposerBox>[0]),
			);
		});
		return calls;
	}
	const controls = () =>
		["composer-investigate", "composer-ask", "composer-send"].filter((id) => q(id) !== null);
	const enter = async () => {
		await act(async () => {
			q("composer-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		});
	};

	it.each([
		["a draft set to Investigate", { mode: "draft", verbs: ["investigate", "ask"], verb: "investigate" }, ["composer-investigate"], true],
		["a draft set to Ask", { mode: "draft", verbs: ["investigate", "ask"], verb: "ask" }, ["composer-ask"], true],
		["a live thread", { mode: "live", verbs: [], verb: "ask" }, ["composer-send"], false],
		["a stopped reportless run set to Investigate", { mode: "continue", verbs: ["investigate", "ask"], verb: "investigate" }, ["composer-investigate"], true],
		["a stopped reportless run set to Ask", { mode: "continue", verbs: ["investigate", "ask"], verb: "ask" }, ["composer-send"], true],
		["a finished investigation", { mode: "resume", verbs: [], verb: "ask" }, ["composer-send"], false],
	])("%s: one send control, chip %s", async (_name, props, shown, chip) => {
		await render(props);
		expect(controls()).toEqual(shown);
		expect(q("verb-chip") !== null).toBe(chip);
	});

	it("Enter follows the verb on a draft", async () => {
		const investigates = await render({ mode: "draft", verbs: ["investigate", "ask"], verb: "investigate" });
		await enter();
		expect(investigates.investigate).toHaveBeenCalledTimes(1);
		expect(investigates.ask).not.toHaveBeenCalled();

		const asks = await render({ mode: "draft", verbs: ["investigate", "ask"], verb: "ask" });
		await enter();
		expect(asks.ask).toHaveBeenCalledTimes(1);
	});

	it("a thread blocked by another live one sends nothing", async () => {
		const calls = await render({ mode: "resume", blockedReason: "Run #2 is working; message it or stop it" });
		await enter();
		expect(calls.message).not.toHaveBeenCalled();
		expect(q("composer-blocked").textContent).toBe("Run #2 is working; message it or stop it");
	});

	it.each([
		["a live report turn", { state: "working", investigation: { id: "inv-1", liveTurn: "report" } }, "continue"],
		["a live answer turn", { state: "working", investigation: { id: "inv-1", liveTurn: "answer" } }, "chat"],
		["a stopped reportless run on Investigate", { state: "stopped", continuable: true, resumable: true, investigation: { id: "inv-1" } }, "continue"],
		["a finished investigation", { state: "done", resumable: true, investigation: { id: "inv-1", hasReport: true } }, "chat"],
	])("every send carries kind: %s sends %s", async (_name, run, kind) => {
		record.run = run;
		record.sendMessage.mockResolvedValue(undefined);
		await act(async () => {
			root.render(createElement(DockedComposer, {}));
		});
		await type("go on");
		await enter();
		expect(record.sendMessage).toHaveBeenCalledWith("go on", "queue", expect.objectContaining({ kind }));
	});
});

describe("DockedComposer messages (#743)", () => {
	it("keeps the typed message until the API accepts it, and after a refusal", async () => {
		let fail: (e: Error) => void = () => {};
		record.sendMessage.mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					fail = reject;
				}),
		);
		await act(async () => {
			root.render(createElement(DockedComposer, {}));
		});
		await type("why the pool?");
		await act(async () => {
			q<HTMLButtonElement>("composer-send").click();
		});

		expect(q<HTMLTextAreaElement>("composer-input").value).toBe("why the pool?");
		expect(record.sendMessage).toHaveBeenCalledWith("why the pool?", "queue", expect.objectContaining({ attachments: [] }));

		await act(async () => fail(new Error("Internal server error")));
		expect(q<HTMLTextAreaElement>("composer-input").value).toBe("why the pool?");
		expect(q("composer-refusal").textContent).toBe("Internal server error");
	});
});

describe("the status line's Last message (#804 OBJ-028)", () => {
	it("says an Ask errored on a stopped run, and stays quiet when the standing already says it", () => {
		expect(lastMessageWord({ status: "cancelled", lastTurnOutcome: "error" })).toBe("Last message: error");
		expect(lastMessageWord({ status: "completed", lastTurnOutcome: "stopped" })).toBe("Last message: stopped by you");
		expect(lastMessageWord({ status: "cancelled", lastTurnOutcome: "stopped" })).toBeNull();
		expect(lastMessageWord({ status: "failed", lastTurnOutcome: "error" })).toBeNull();
		expect(lastMessageWord({ status: "cancelled", lastTurnOutcome: "answered" })).toBeNull();
	});
});
