// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer";

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
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

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
	return props;
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

async function type(text: string) {
	const box = q("composer-input") as HTMLTextAreaElement;
	await act(async () => {
		const set = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set;
		set?.call(box, text);
		box.dispatchEvent(new Event("input", { bubbles: true }));
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
		const onSend = vi.fn();
		await render({ onSend });
		const box = await type("  rename it  ");
		await act(async () =>
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		expect(onSend).toHaveBeenCalledWith(
			{ text: "rename it", files: [] },
			false,
		);
		expect(box.value).toBe("");

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
		expect(again.value).toBe("again");
	});

	it("withholds the box with the reason when nothing can be sent", async () => {
		await render({ blockedReason: "Sign in to Claude Code" });
		expect((q("composer-input") as HTMLTextAreaElement).disabled).toBe(true);
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
		expect(q("composer-slash")).toBeNull();
		await type("/");
		expect(q("composer-slash-investigate")).not.toBeNull();
		expect(q("composer-slash-note")).not.toBeNull();
		const box = await type("/no");
		expect(q("composer-slash-investigate")).toBeNull();
		await act(async () => {
			box.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(note).toHaveBeenCalledOnce();
		expect(onSend).not.toHaveBeenCalled();
		expect(box.value).toBe("");
		await type("/ship it");
		expect(q("composer-slash")).toBeNull();
	});
});
