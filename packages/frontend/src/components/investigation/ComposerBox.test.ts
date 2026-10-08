// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerBox } from "./ComposerBox";
import { DockedComposer } from "./DockedComposer";

const record = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/agent/AgentPicker", () => ({
	AccessMenu: () => null,
	AgentModelChip: () => null,
	AgentModelPicker: () => null,
	EffortMenu: () => null,
	useAgentChoice: () => ({ harnesses: [], effective: undefined }),
}));
vi.mock("@/components/incidents/RunStrip", () => ({
	useRunAgentModel: () => ({ agent: "OpenCode", model: "m" }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/incidents/record-context", () => ({
	useIncidentRecord: () => ({
		run: {
			state: "working",
			investigation: { harness: "opencode", agentMode: "plan", agentModeName: "Plan" },
			sendMessage: record.sendMessage,
			stop: vi.fn(),
			waiting: 0,
			stopRequested: false,
			continuable: false,
			resumable: false,
			undeliverable: null,
			clearUndeliverable: vi.fn(),
		},
		investigationId: "inv-1",
		incident: { id: "inc-1" },
		canInvestigate: true,
		isInvestigating: false,
		investigate: vi.fn(),
		addNote: vi.fn(),
	}),
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
					onInvestigate: () => {},
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
			root.render(createElement(DockedComposer));
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
