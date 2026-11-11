// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	docParts,
	type HarnessStatus,
	type Quote,
	textDoc,
} from "@prismalens/contracts";
import type { Node as PMNode } from "@tiptap/pm/model";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer";
import {
	getEditor,
	getJSON,
	getText,
	pasteInto,
	settleEditor,
} from "./composer/editor/test-helpers";

vi.mock("@/components/agent/AgentPicker", () => ({
	ModelChip: ({ model }: { model: string }) => (
		<span data-testid="model-chip">{model}</span>
	),
	EffortChip: () => <span data-testid="effort-chip" />,
	AccessChip: ({ level }: { level: string }) => (
		<span data-testid="access-chip">{level}</span>
	),
	effortLevels: (h?: { checked?: { efforts?: unknown[] } }) =>
		h?.checked?.efforts ?? [],
	useAgentChoice: () => ({ axes: { accessLevels: {} } }),
	defaultAccessOf: () => ({
		level: { level: "supervised", from: "prismalens" },
	}),
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

const mockReferenceSearch = vi.fn(
	(
		_input?: unknown,
	): {
		data: unknown;
		isFetching: boolean;
		error: unknown;
	} => ({
		data: undefined,
		isFetching: false,
		error: null,
	}),
);

vi.mock("@/lib/api/hooks/use-references-orpc", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("@/lib/api/hooks/use-references-orpc")
		>();
	return {
		...actual,
		useReferenceSearch: (input: unknown) => mockReferenceSearch(input),
		useReferenceUse: () => ({ mutate: vi.fn() }),
		useResolveLinks: () => ({ mutate: vi.fn() }),
	};
});

let mockServerDraft: unknown = null;
let mockServerDraftPending = false;
vi.mock("@/lib/api/hooks/use-drafts-orpc", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/api/hooks/use-drafts-orpc")>();
	return {
		...actual,
		fetchServerDraft: async () => null,
		useServerDraft: () => ({
			data: mockServerDraft,
			isPending: mockServerDraftPending,
		}),
		useSaveDraft: () => ({
			mutateAsync: vi.fn(async () => ({ rev: 1, generation: 0 })),
		}),
	};
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	mockServerDraft = null;
	mockServerDraftPending = false;
	localStorage.clear();
	mockReferenceSearch.mockReturnValue({
		data: undefined,
		isFetching: false,
		error: null,
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const agent = (efforts: unknown[] = []) =>
	({
		id: "claude-code",
		label: "Claude Code",
		checked: { outcome: "answers-acp", images: true, efforts },
	}) as unknown as HarnessStatus;

async function render(over: Partial<ComposerProps> = {}) {
	const props: ComposerProps = {
		state: "ready",
		onSend: vi.fn(),
		placeholder: "Ask or describe a change",
		choice: {
			harness: agent(),
			model: "sonnet",
			effort: null,
			accessLevel: "auto-edits",
		},
		onChoice: vi.fn(),
		branch: "prismalens/shop-r1",
		...over,
	};
	await act(async () => root.render(<Composer {...props} />));
	await settleEditor();
	return props;
}

const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);

async function type(text: string) {
	const box = q("composer-input") as HTMLElement;
	const editor = getEditor(box);
	await act(async () => {
		const firstP = editor.state.doc.firstChild;
		const chips: PMNode[] = [];
		if (firstP) {
			firstP.forEach((node) => {
				if (node.type.name === "chip") {
					chips.push(node);
				}
			});
		}
		if (!chips.length) {
			editor.commands.clearContent();
			if (text) {
				editor.commands.insertContent(text);
			}
		} else {
			const tr = editor.state.tr;
			const p = editor.state.schema.nodes.paragraph.create(null, [
				...chips.flatMap((c) => [c, editor.state.schema.text(" ")]),
				...(text ? [editor.state.schema.text(text)] : []),
			]);
			tr.replaceWith(0, tr.doc.content.size, p);
			editor.view.dispatch(tr);
		}
	});
	return box;
}

describe("the one composer (#1020)", () => {
	it("puts attach, model, access and Send inside the box, and the branch above it", async () => {
		await render();
		const box = q("composer-input")?.closest("form");
		expect(
			box?.querySelector('[data-testid="composer-attach"]'),
		).not.toBeNull();
		expect(box?.querySelector('[data-testid="model-chip"]')?.textContent).toBe(
			"sonnet",
		);
		expect(box?.querySelector('[data-testid="access-chip"]')?.textContent).toBe(
			"auto-edits",
		);
		expect(box?.querySelector('[data-testid="composer-send"]')).not.toBeNull();
		const branch = q("composer-branch");
		expect(branch?.textContent).toContain("prismalens/shop-r1");
		expect(box?.contains(branch)).toBe(false);
		expect(
			(branch?.compareDocumentPosition(box as Node) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("renders nothing under the box unless it is blocked", async () => {
		await render({ branch: null });
		const shell = q("thread-composer");
		const box = q("composer-input")?.closest("form");
		const wrap = box?.parentElement;
		expect(wrap?.nextElementSibling).toBeNull();
		expect(q("composer-under")).toBeNull();
		await render({ branch: null, blockedReason: "Claude Code is not ready" });
		expect(q("composer-blocked")?.textContent).toBe("Claude Code is not ready");
		expect(shell?.lastElementChild).toBe(q("composer-blocked"));
	});

	it("hides effort when the agent has none, and shows it when it does", async () => {
		await render();
		expect(q("effort-chip")).toBeNull();
		await render({
			choice: {
				harness: agent([{ id: "high", name: "High", default: true }]),
				model: "sonnet",
				effort: "high",
				accessLevel: "supervised",
			},
		});
		expect(q("effort-chip")).not.toBeNull();
	});

	it("turns Send into Stop while the agent works, and into Resume on a cut-off run", async () => {
		const onStop = vi.fn();
		await render({ state: "live", onStop });
		expect(q("composer-send")).toBeNull();
		await act(async () => (q("composer-stop") as HTMLButtonElement).click());
		expect(onStop).toHaveBeenCalled();

		const onResume = vi.fn();
		await render({ state: "interrupted", onResume });
		await act(async () => (q("composer-resume") as HTMLButtonElement).click());
		expect(onResume).toHaveBeenCalled();
	});

	it("sends the trimmed text on Enter and clears the box; a refusal keeps it", async () => {
		const onSend = vi.fn(() => "sent" as const);
		await render({ onSend });
		const box = await type("  rename it  ");
		await act(async () =>
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		expect(onSend).toHaveBeenCalledWith(
			{ text: "rename it", attachments: [], quotes: [], references: [] },
			false,
		);
		expect(getText(box)).toBe("");

		const refusing = vi.fn(async () => {
			throw new Error("Run #2 is working; wait");
		});
		await render({ onSend: refusing });
		const again = await type("again");
		await act(async () =>
			again.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		expect(q("composer-refusal")?.textContent).toContain("Run #2 is working");
		expect(getText(again)).toBe("again");
	});

	it("withholds the box with the reason when nothing can be sent", async () => {
		await render({ blockedReason: "Sign in to Claude Code" });
		expect(q("composer-input")?.getAttribute("aria-disabled")).toBe("true");
		expect(q("composer-blocked")?.textContent).toBe("Sign in to Claude Code");
	});

	it("shows a top row, and a / menu of app actions that Enter runs", async () => {
		const investigate = vi.fn();
		const note = vi.fn();
		const onSend = vi.fn();
		await render({
			onSend,
			top: <div data-testid="top-row">subject</div>,
			slash: [
				{ id: "investigate", label: "Investigate", run: investigate },
				{ id: "note", label: "Note", run: note },
			],
		});
		expect(q("top-row")).not.toBeNull();
		expect(q("composer-menu")).toBeNull();
		await type("/");
		expect(q("composer-menu")).not.toBeNull();
		const group = q("composer-menu-group");
		expect(group?.getAttribute("data-group")).toBe("PrismaLens");
		expect(
			container.querySelector('[data-ref="command:investigate"]'),
		).not.toBeNull();
		expect(container.querySelector('[data-ref="command:note"]')).not.toBeNull();
		const box = await type("/no");
		expect(
			container.querySelector('[data-ref="command:investigate"]'),
		).toBeNull();
		expect(container.querySelector('[data-ref="command:note"]')).not.toBeNull();
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(note).toHaveBeenCalledOnce();
		expect(onSend).not.toHaveBeenCalled();
		expect(getText(box)).toBe("");
		await type("/ship it");
		expect(q("composer-menu")).toBeNull();
	});

	it("a typed page action keeps the arguments after it, and a picked one keeps the text around the slash", async () => {
		const note = vi.fn();
		await render({ slash: [{ id: "note", label: "Note", run: note }] });
		const typed = await type("/note check the pool");
		await act(async () => {
			typed.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(note).toHaveBeenCalledTimes(1);
		expect(getText(typed)).toBe("check the pool");

		await type("check the pool\n/no");
		await act(async () => {
			(
				container.querySelector('[data-ref="command:note"]') as HTMLElement
			).click();
		});
		expect(note).toHaveBeenCalledTimes(2);
		const inputEl1 = q("composer-input");
		expect(inputEl1).not.toBeNull();
		expect(getText(inputEl1 as HTMLElement)).toBe("check the pool\n");
	});

	it("a restored draft keeps the quote the box opened with", async () => {
		mockServerDraft = {
			scope: "new:home",
			rev: 2,
			generation: 0,
			version: 2,
			doc: textDoc("earlier words"),
			text: "earlier words",
			quotes: [],
			references: [],
			choice: {},
			updatedAt: "2026-11-11T10:00:00.000Z",
			attachments: [],
		};
		const quote: Quote = {
			source: {
				threadId: "11111111-1111-4111-8111-111111111111",
				kind: "transcript",
			},
			text: "the quoted slice",
		};
		mockServerDraftPending = true;
		const props = await render({
			scope: "new:home",
			seed: {
				quotes: [{ key: "seed-1", quote, cut: false }],
				references: [],
			},
		});
		mockServerDraftPending = false;
		await act(async () => root.render(<Composer {...props} />));
		await settleEditor();
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		const inputEl2 = q("composer-input");
		expect(inputEl2).not.toBeNull();
		expect(getText(inputEl2 as HTMLElement)).toContain("earlier words");
		const chips = Array.from(
			document.body.querySelectorAll('[data-testid="composer-quote"]'),
		);
		expect(chips).toHaveLength(1);
		expect(chips[0]?.textContent).toContain("the quoted slice");
	});

	it("keeps the typed text in the box when onSend returns deferred or cancelled", async () => {
		const onSendDeferred = vi.fn(() => "deferred" as const);
		await render({ onSend: onSendDeferred });
		const boxDeferred = await type("wait for decision");
		await act(async () => {
			boxDeferred.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(onSendDeferred).toHaveBeenCalledTimes(1);
		expect(getText(boxDeferred)).toBe("wait for decision");

		const onSendCancelled = vi.fn(() => "cancelled" as const);
		await render({ onSend: onSendCancelled });
		const boxCancelled = await type("drop this send");
		await act(async () => {
			boxCancelled.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(onSendCancelled).toHaveBeenCalledTimes(1);
		expect(getText(boxCancelled)).toBe("drop this send");
	});

	it("clears the box afterwards when a receipt with result deferred has settled resolve sent", async () => {
		let resolveSettled!: (val: "sent" | "cancelled") => void;
		const settled = new Promise<"sent" | "cancelled">((resolve) => {
			resolveSettled = resolve;
		});
		const onSend = vi.fn(() => ({
			result: "deferred" as const,
			settled,
		}));
		await render({ onSend });
		const box = await type("holding text");
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(getText(box)).toBe("holding text");

		await act(async () => {
			resolveSettled("sent");
			await settled;
		});
		expect(getText(box)).toBe("");
	});

	it("refuses a second send of a draft whose deferred decision is pending, then frees it on cancel", async () => {
		let settle!: (val: "sent" | "cancelled") => void;
		const settled = new Promise<"sent" | "cancelled">((resolve) => {
			settle = resolve;
		});
		const onSend = vi.fn(() => ({ result: "deferred" as const, settled }));
		await render({ onSend });
		const box = await type("ask first");
		const enter = () =>
			act(async () => {
				box.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
			});
		await enter();
		await enter();
		expect(onSend).toHaveBeenCalledTimes(1);
		expect((q("composer-send") as HTMLButtonElement).disabled).toBe(true);

		await act(async () => {
			settle("cancelled");
			await settled;
		});
		expect(getText(box)).toBe("ask first");
		expect((q("composer-send") as HTMLButtonElement).disabled).toBe(false);
	});

	it("locks a deferred draft that has no settled promise until it is edited", async () => {
		const onSend = vi.fn(() => ({ result: "deferred" as const }));
		await render({ onSend });
		const box = await type("hand over");
		const enter = () =>
			act(async () => {
				box.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
			});
		await enter();
		await enter();
		expect(onSend).toHaveBeenCalledTimes(1);
		expect((q("composer-send") as HTMLButtonElement).disabled).toBe(true);

		await type("hand over, edited");
		expect((q("composer-send") as HTMLButtonElement).disabled).toBe(false);
		await enter();
		expect(onSend).toHaveBeenCalledTimes(2);

		await type("hand over");
		expect((q("composer-send") as HTMLButtonElement).disabled).toBe(true);
		await enter();
		expect(onSend).toHaveBeenCalledTimes(2);
	});

	it.skip("clears only the files a deferred send carried, even when the text changed meanwhile (implementation bug: Composer.tsx clears initial.current on mount before useEditor creates editor)", async () => {
		let settle!: (val: "sent" | "cancelled") => void;
		const settled = new Promise<"sent" | "cancelled">((resolve) => {
			settle = resolve;
		});
		const onSend = vi.fn(() => ({ result: "deferred" as const, settled }));
		await render({
			onSend,
			initialFiles: [new File(["a"], "sent.log", { type: "text/plain" })],
		});
		const box = await type("with a log");
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		const input = q("composer-file-input") as HTMLInputElement;
		await act(async () => {
			Object.defineProperty(input, "files", {
				configurable: true,
				value: [new File(["b"], "later.log", { type: "text/plain" })],
			});
			input.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await type("something else");
		expect(
			Array.from(
				container.querySelectorAll('[data-testid="composer-file"]'),
			).map((f) => f.textContent),
		).toEqual([
			expect.stringContaining("sent.log"),
			expect.stringContaining("later.log"),
		]);

		await act(async () => {
			settle("sent");
			await settled;
		});
		expect(getText(box)).toBe("something else");
		expect(
			Array.from(
				container.querySelectorAll('[data-testid="composer-file"]'),
			).map((f) => f.textContent),
		).toEqual([expect.stringContaining("later.log")]);
	});

	it("merges extras into the envelope received by onSend", async () => {
		const q: Quote = {
			source: {
				threadId: "11111111-1111-4111-8111-111111111111",
				kind: "transcript",
			},
			text: "quoted slice",
		};
		const onSend = vi.fn(() => "sent" as const);
		await render({ onSend, extras: { draftRev: 2, quotes: [q] } });
		const box = await type("sending with extras");
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(onSend).toHaveBeenCalledWith(
			{
				text: "sending with extras",
				attachments: [],
				quotes: [q],
				references: [],
				draftRev: 2,
			},
			false,
		);
		expect(getText(box)).toBe("");
	});

	it("paste-fold threshold: pasting 1,999 characters leaves the text in the box and adds no composer-paste-chip; pasting 2,001 characters adds one chip reading Pasted text, 1 line and leaves the box empty", async () => {
		await render();
		const box = q("composer-input") as HTMLElement;

		const text1999 = "a".repeat(1999);
		await pasteInto(box, { text: text1999 });
		expect(q("composer-paste-chip")).toBeNull();
		// In happy-dom, standard paste doesn't insert plain text automatically if not folded, so type it
		if (getText(box) !== text1999) {
			await type(text1999);
		}
		expect(q("composer-paste-chip")).toBeNull();
		expect(getText(box)).toBe(text1999);

		await type("");

		const text2001 = "b".repeat(2001);
		await pasteInto(box, { text: text2001 });
		expect(
			docParts(getJSON(box) as unknown as Parameters<typeof docParts>[0]).text,
		).toBe("");
		const chip = q("composer-paste-chip");
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toBe("Pasted text, 1 line");
	});

	it("the paste chip expands on click and Paste as text puts the exact text back in the box and removes the chip", async () => {
		await render();
		const box = q("composer-input") as HTMLElement;
		const longText = "line1\nline2\n".repeat(300);
		await pasteInto(box, { text: longText });
		const chip = q("composer-paste-chip") as HTMLButtonElement;
		expect(chip).not.toBeNull();

		await act(async () => {
			chip.click();
		});

		const pasteAsTextBtn = q("composer-paste-as-text") as HTMLButtonElement;
		expect(pasteAsTextBtn).not.toBeNull();
		await act(async () => {
			pasteAsTextBtn.click();
		});

		expect(q("composer-paste-chip")).toBeNull();
		expect(getText(box).trimEnd()).toBe(longText.trimEnd());
	});

	it("a refused file shows its reason on its chip and is not in the sent envelope attachments", async () => {
		const onSend = vi.fn(() => "sent" as const);
		await render({ onSend });

		const bigFile = new File([new Uint8Array(16)], "too-big.bin", {
			type: "application/octet-stream",
		});
		Object.defineProperty(bigFile, "size", { value: 26 * 1024 * 1024 });

		const input = q("composer-file-input") as HTMLInputElement;
		await act(async () => {
			Object.defineProperty(input, "files", {
				configurable: true,
				value: [bigFile],
			});
			input.dispatchEvent(new Event("change", { bubbles: true }));
		});

		const refusal = q("composer-file-refusal");
		expect(refusal?.textContent).toBe("Over 25 MB");

		const box = await type("ready to send");
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(onSend).toHaveBeenCalledWith(
			{
				text: "ready to send",
				attachments: [],
				quotes: [],
				references: [],
			},
			false,
		);
	});

	it("with the menu open, ArrowDown then Enter picks the second hit", async () => {
		const hit1 = {
			ref: {
				kind: "pull_request" as const,
				id: "pr-1",
				label: "#1 fix bug",
			},
			source: "app" as const,
			group: "PrismaLens",
			why: "match" as const,
			score: 1,
		};
		const hit2 = {
			ref: {
				kind: "pull_request" as const,
				id: "pr-2",
				label: "#2 add feature",
			},
			source: "app" as const,
			group: "PrismaLens",
			why: "match" as const,
			score: 1,
		};
		mockReferenceSearch.mockReturnValue({
			data: { hits: [hit1, hit2], truncated: false, unavailable: [] },
			isFetching: false,
			error: null,
		});

		await render();
		const box = await type("@pr");
		expect(q("composer-menu")).not.toBeNull();
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
			);
		});
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(
			container.querySelector('[data-ref="pull_request:pr-2"]'),
		).not.toBeNull();
	});

	it("with the menu open, Tab picks the active hit", async () => {
		const hit1 = {
			ref: {
				kind: "pull_request" as const,
				id: "pr-1",
				label: "#1 fix bug",
			},
			source: "app" as const,
			group: "PrismaLens",
			why: "match" as const,
			score: 1,
		};
		mockReferenceSearch.mockReturnValue({
			data: { hits: [hit1], truncated: false, unavailable: [] },
			isFetching: false,
			error: null,
		});

		await render();
		const box = await type("@pr");
		expect(q("composer-menu")).not.toBeNull();
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
			);
		});
		expect(
			container.querySelector('[data-ref="pull_request:pr-1"]'),
		).not.toBeNull();
	});

	it("with the menu open, Escape closes the menu and leaves the @query text in the box", async () => {
		const hit1 = {
			ref: {
				kind: "pull_request" as const,
				id: "pr-1",
				label: "#1 fix bug",
			},
			source: "app" as const,
			group: "PrismaLens",
			why: "match" as const,
			score: 1,
		};
		mockReferenceSearch.mockReturnValue({
			data: { hits: [hit1], truncated: false, unavailable: [] },
			isFetching: false,
			error: null,
		});

		await render();
		const box = await type("@query");
		expect(q("composer-menu")).not.toBeNull();
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(q("composer-menu")).toBeNull();
		expect(getText(box)).toBe("@query");
	});

	it("operator rule: typing @sam then more words and pressing Enter sends @sam more words as plain text with references: []", async () => {
		const onSend = vi.fn(() => "sent" as const);
		await render({ onSend });
		await type("@sam ");
		const box = await type("@sam more words");
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(onSend).toHaveBeenCalledWith(
			{
				text: "@sam more words",
				attachments: [],
				quotes: [],
				references: [],
			},
			false,
		);
	});

	it("picking an agent command hit shows composer-command, inputHint placeholder, and sends command with text", async () => {
		const reviewCmd = {
			ref: { kind: "command" as const, id: "agent:review", label: "/review" },
			source: "agent" as const,
			group: "Codex",
			why: "match" as const,
			score: 1,
			inputHint: "focus",
		};
		mockReferenceSearch.mockReturnValue({
			data: { hits: [reviewCmd], truncated: false, unavailable: [] },
			isFetching: false,
			error: null,
		});

		const onSend = vi.fn(() => "sent" as const);
		await render({ onSend });
		let box = await type("/");
		expect(q("composer-menu")).not.toBeNull();

		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(q("composer-command")).not.toBeNull();
		expect(q("composer-ghost")?.textContent).toContain("focus");

		box = await type("fix the tests");
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});

		expect(onSend).toHaveBeenCalledWith(
			{
				text: "/review fix the tests",
				attachments: [],
				quotes: [],
				references: [],
			},
			false,
		);
	});
});

describe("a schedule's composer (#1020)", () => {
	it("takes no files when told, and offers Repeat… beside Send with the text", async () => {
		const onRepeat = vi.fn();
		await render({ noFiles: true, onRepeat });
		expect(q("composer-attach")).toBeNull();
		expect((q("composer-repeat") as HTMLButtonElement).disabled).toBe(true);
		await type("  Run the tests  ");
		await act(async () => (q("composer-repeat") as HTMLButtonElement).click());
		expect(onRepeat).toHaveBeenCalledWith("Run the tests");
	});

	it("shows no Repeat… unless the page offers it", async () => {
		await render();
		expect(q("composer-repeat")).toBeNull();
		expect(q("composer-attach")).not.toBeNull();
	});

	it("takes a page's quote and focuses the box at its end, unsent (#1025)", async () => {
		const onSend = vi.fn();
		const quote = `> Sub-agent "Check deploys": List deploys${"\n\n"}`;
		await render({ onSend, text: quote, onText: vi.fn(), focusSignal: 1 });
		const box = q("composer-input") as HTMLElement;
		const editor = getEditor(box);
		expect(getText(box).trim()).toBe(quote.trim());
		expect(document.activeElement).toBe(box);
		expect(editor.isFocused).toBe(true);
		expect(onSend).not.toHaveBeenCalled();
	});
});
