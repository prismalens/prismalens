// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionProps, Composer, type ComposerAction } from "../thread/Composer";
import {
	getText,
	settleEditor,
	typeIn,
} from "../thread/composer/editor/test-helpers";
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
	AccessChip: () => null,
	effortLevels: () => [],
	defaultAccessOf: () => ({
		level: { level: "supervised", from: "prismalens" },
	}),
	modelName: (_h: unknown, id: string) => id,
	unreadyReason: () => null,
	useAgentChoice: () => ({
		harnesses: [],
		effective: undefined,
		model: "",
		efforts: {},
		axes: { accessLevels: {} },
	}),
}));
vi.mock("@/lib/api/hooks", () => ({
	useUpdateHarnessSettings: () => ({ mutate: vi.fn() }),
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
	useIncidentRecord: () => ({
		run: {
			state: "working",
			events: [],
			pending: [],
			investigation: { id: "inv-1", harness: "opencode", agentMode: "plan", agentModeName: "Plan", liveTurn: "report" },
			sendMessage: record.sendMessage,
			stop: vi.fn(),
			waiting: 0,
			queued: [],
			asks: [],
			steps: [],
			awaiting: false,
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
		setDraftFiles: () => {},
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
	runAccessLine: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGE = { id: "message", label: "Message", detail: "At the next pause.", needsText: true };
const OPENCODE = { id: "opencode", label: "OpenCode", checked: { outcome: "answers-acp", images: true } };

/** The shared box as the incident pages mount it: actions, text kept by the page (#1020). */
function box(p: {
	actions: ComposerAction[];
	action: string;
	onAction?: (id: string) => void;
	live?: boolean;
	text: string;
	onSend: () => "sent";
	[k: string]: unknown;
}) {
	const { actions, action, onAction = () => {}, live, ...rest } = p;
	return createElement(Composer, {
		state: live ? "live" : "ready",
		placeholder: "p",
		choice: { harness: OPENCODE as never, model: "", effort: null, accessLevel: "supervised" },
		onChoice: () => {},
		...actionProps(actions, action, onAction),
		...rest,
	} as Parameters<typeof Composer>[0]);
}

let container: HTMLDivElement;
let root: Root;
const q = <T extends Element>(testId: string) =>
	container.querySelector(`[data-testid="${testId}"]`) as T;

async function type(text: string) {
	const field = q("composer-input");
	await typeIn(field, text);
}

async function attach(file: File) {
	const input = q<HTMLInputElement>("composer-file-input");
	Object.defineProperty(input, "files", { value: [file], configurable: true });
	await act(async () => {
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

beforeEach(() => {
	localStorage.clear();
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

describe("the box's image previews (R4.3)", () => {
	it.skip(
		"keeps a shown thumbnail's URL when another file is added, and revokes each on remove and unmount (implementation bug: Composer does not revoke preview on chip remove to allow undo, only revoking on unmount)",
		async () => {
			let n = 0;
			vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++n}`);
			const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
			await act(async () => {
				root.render(
					box({
						actions: [MESSAGE],
						action: "message",
						live: true,
						text: "",
						onSend: () => "sent",
					}),
				);
			});
			await settleEditor();

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
		},
	);
});

describe("the box: one chip row, one Send (#811, #1020)", () => {
	const ASK = { id: "ask", label: "Ask", detail: "A question.", needsText: true };
	const INVESTIGATE = { id: "investigate", label: "Investigate", detail: "A run.", needsText: false };
	async function render(props: Record<string, unknown>) {
		const onSend = vi.fn(() => "sent" as const);
		const onAction = vi.fn();
		await act(async () => {
			root.render(
				box({
					actions: [ASK, INVESTIGATE],
					action: "ask",
					onAction,
					text: "why the pool?",
					onSend,
					...props,
				}),
			);
		});
		await settleEditor();
		return { onSend, onAction };
	}
	const enter = async (ctrl = false) => {
		await act(async () => {
			q("composer-input").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", ctrlKey: ctrl, bubbles: true }),
			);
		});
	};

	it("names the action above the box and offers the others under /, only where there is a choice", async () => {
		const { onAction } = await render({ text: undefined });
		await type("/");
		expect(q("composer-mode").getAttribute("data-mode")).toBe("ask");
		expect(q("composer-mode-clear")).toBeNull();
		expect(container.querySelector('[data-ref="command:ask"]')).toBeNull();
		await act(async () =>
			(
				container.querySelector(
					'[data-ref="command:investigate"]',
				) as HTMLElement
			).click(),
		);
		expect(onAction).toHaveBeenCalledWith("investigate");
		const picked = await render({ action: "investigate" });
		expect(q("composer-mode").textContent).toContain("Investigate");
		await act(async () => q<HTMLButtonElement>("composer-mode-clear").click());
		expect(picked.onAction).toHaveBeenCalledWith("ask");
		await render({ actions: [MESSAGE], action: "message", live: true });
		expect(document.querySelector('[data-testid="composer-mode"]')).toBeNull();
		expect(document.querySelector('[data-testid="action-chip"]')).toBeNull();
	});

	it("wraps chips from sm up; on a phone one row scrolls and no chip shrinks (#1020, #673 QA-06)", async () => {
		await render({});
		const chips = q("composer-chips");
		expect(chips.classList.contains("sm:flex-wrap")).toBe(true);
		expect(chips.classList.contains("max-sm:overflow-x-auto")).toBe(true);
		expect(chips.classList.contains("max-sm:[&>*]:shrink-0")).toBe(true);
	});

	it("Enter sends; Ctrl+Enter sends now only on a live run", async () => {
		const draft = await render({});
		await enter(true);
		expect(draft.onSend).toHaveBeenCalledWith({ text: "why the pool?", attachments: [], quotes: [], references: [] }, false);
		await act(async () => root.unmount());
		root = createRoot(container);
		const live = await render({ actions: [MESSAGE], action: "message", live: true });
		await enter(true);
		expect(live.onSend).toHaveBeenCalledWith({ text: "why the pool?", attachments: [], quotes: [], references: [] }, true);
	});

	it("an action that needs text does not send an empty box; one that does not, does", async () => {
		const asks = await render({ text: "" });
		await enter();
		expect(asks.onSend).not.toHaveBeenCalled();
		expect(q<HTMLButtonElement>("composer-send").disabled).toBe(true);
		const investigates = await render({ text: "", action: "investigate" });
		await enter();
		expect(investigates.onSend).toHaveBeenCalledTimes(1);
	});

	it.skip(
		"a removed prefill file is reported back, so a remount does not bring it back (implementation bug: Composer.tsx clears initial.current on mount before useEditor creates editor)",
		async () => {
			const onFilesChange = vi.fn();
			const a = new File(["a"], "a.log");
			const b = new File(["b"], "b.log");
			await render({ initialFiles: [a, b], onFilesChange });
			await act(async () => {
				(container.querySelector('[aria-label="Remove a.log"]') as HTMLButtonElement).click();
			});
			expect(onFilesChange.mock.calls.at(-1)).toEqual([[b]]);
		},
	);

	it("a thread blocked by another live one sends nothing", async () => {
		const calls = await render({ blockedReason: "Run 2 is working; message it or stop it" });
		await enter();
		expect(calls.onSend).not.toHaveBeenCalled();
		expect(q("composer-blocked").textContent).toBe("Run 2 is working; message it or stop it");
	});

	it("a run with no session offers a new run instead of the box", async () => {
		const onNewRun = vi.fn();
		await render({ ended: { onNewRun } });
		expect(q("composer-input")).toBeNull();
		await act(async () => q<HTMLButtonElement>("composer-new-run").click());
		expect(onNewRun).toHaveBeenCalledTimes(1);
	});

	it("a reported run with no session also offers Investigate again", async () => {
		const onRecheck = vi.fn();
		await render({ ended: { onNewRun: vi.fn(), onRecheck } });
		await act(async () => q<HTMLButtonElement>("composer-recheck").click());
		expect(onRecheck).toHaveBeenCalledTimes(1);
	});
});

describe("DockedComposer sends (#673 w59, #811)", () => {
	const enter = async () => {
		await act(async () => {
			q("composer-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		});
	};
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
		await settleEditor();
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
		await settleEditor();
		await type("why the pool?");
		await act(async () => {
			q<HTMLButtonElement>("composer-send").click();
		});

		expect(getText(q("composer-input"))).toBe("why the pool?");
		expect(record.sendMessage).toHaveBeenCalledWith("why the pool?", "queue", expect.objectContaining({ attachments: [] }));

		await act(async () => fail(new Error("Internal server error")));
		expect(getText(q("composer-input"))).toBe("why the pool?");
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
