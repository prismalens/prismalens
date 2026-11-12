// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskDock } from "./AskDock";

const mockAnswerMutate = vi.fn();
const mockSecretMutate = vi.fn();
let mockOnHost = false;

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ managesPairing: mockOnHost }),
}));

vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useAnswerAsk: () => ({ mutate: mockAnswerMutate, isPending: false }),
	useAnswerSecret: () => ({ mutate: mockSecretMutate, isPending: false }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	mockOnHost = false;
	mockAnswerMutate.mockReset();
	mockSecretMutate.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const q = <T extends HTMLElement = HTMLElement>(id: string) =>
	container.querySelector(`[data-testid="${id}"]`) as T;

const THREAD = "00000000-0000-4000-8000-000000000001";

const baseAsk = (over: Partial<PendingAsk>): PendingAsk => ({
	askId: "ask-1",
	threadId: THREAD,
	kind: "question",
	requiresHost: false,
	source: { kind: "agent" },
	title: "Question title",
	openedAt: "2026-11-11T10:00:00.000Z",
	...over,
});

describe("AskDock (#1024)", () => {
	it("question single-choice click answers with the chosen option", async () => {
		const ask = baseAsk({
			askId: "ask-env",
			questions: [
				{
					id: "env",
					prompt: "Which environment?",
					multiSelect: false,
					allowOther: false,
					options: [
						{ id: "prod", label: "Production" },
						{ id: "staging", label: "Staging" },
					],
				},
			],
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		const opt = q("ask-dock-option");
		expect(opt.textContent).toContain("Production");
		await act(async () => {
			opt.click();
		});

		expect(mockAnswerMutate).toHaveBeenCalledWith(
			{
				id: THREAD,
				askId: "ask-env",
				answer: {
					kind: "question",
					answers: {
						env: { options: ["prod"] },
					},
				},
			},
			expect.anything(),
		);
	});

	it("key 2 picks the second option", async () => {
		const ask = baseAsk({
			askId: "ask-key",
			questions: [
				{
					id: "env",
					prompt: "Which environment?",
					multiSelect: false,
					allowOther: false,
					options: [
						{ id: "prod", label: "Production" },
						{ id: "staging", label: "Staging" },
					],
				},
			],
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		await act(async () => {
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", { key: "2", bubbles: true }),
			);
		});

		expect(mockAnswerMutate).toHaveBeenCalledWith(
			{
				id: THREAD,
				askId: "ask-key",
				answer: {
					kind: "question",
					answers: {
						env: { options: ["staging"] },
					},
				},
			},
			expect.anything(),
		);
	});

	it("approval Allow once sends approve decision with scope once", async () => {
		const ask = baseAsk({
			askId: "ask-approval",
			kind: "permission",
			permission: {
				toolKind: "execute",
				options: [{ optionId: "a", name: "Allow", kind: "allow_once" }],
			},
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		const allowBtn = q("ask-dock-allow");
		expect(allowBtn.textContent).toBe("Allow once Alt Y");
		await act(async () => {
			allowBtn.click();
		});

		expect(mockAnswerMutate).toHaveBeenCalledWith(
			{
				id: THREAD,
				askId: "ask-approval",
				answer: {
					kind: "permission",
					decision: "approve",
					scope: "once",
				},
			},
			expect.anything(),
		);
	});

	it("approval Deny with a reason too risky sends deny decision with reason", async () => {
		const ask = baseAsk({
			askId: "ask-deny-reason",
			kind: "permission",
			permission: {
				toolKind: "execute",
				options: [{ optionId: "d", name: "Deny", kind: "reject_once" }],
			},
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		await act(async () => {
			q("ask-dock-deny-reason").click();
		});

		const reasonInput = q<HTMLInputElement>("ask-dock-reason");
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			set?.call(reasonInput, "too risky");
			reasonInput.dispatchEvent(new Event("change", { bubbles: true }));
		});

		const form = reasonInput.closest("form");
		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		expect(mockAnswerMutate).toHaveBeenCalledWith(
			{
				id: THREAD,
				askId: "ask-deny-reason",
				answer: {
					kind: "permission",
					decision: "deny",
					reason: "too risky",
				},
			},
			expect.anything(),
		);
	});

	it("plan Keep planning sends deny decision", async () => {
		const ask = baseAsk({
			askId: "ask-plan",
			kind: "permission",
			title: "Plan ready",
			permission: {
				toolKind: "switch_mode",
				variant: "plan",
				options: [{ optionId: "a", name: "Approve", kind: "allow_once" }],
			},
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		const denyBtn = q("ask-dock-deny");
		expect(denyBtn.textContent).toBe("Keep planning Alt N");
		await act(async () => {
			denyBtn.click();
		});

		expect(mockAnswerMutate).toHaveBeenCalledWith(
			{
				id: THREAD,
				askId: "ask-plan",
				answer: {
					kind: "permission",
					decision: "deny",
				},
			},
			expect.anything(),
		);
	});

	it("input form answers with input kind and values", async () => {
		const ask = baseAsk({
			askId: "ask-input",
			kind: "input",
			input: {
				schema: {
					type: "object",
					properties: {
						channel: { type: "string", title: "Channel" },
					},
				},
			},
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		const form = q<HTMLFormElement>("ask-dock-form");
		const input = form.querySelector("input") as HTMLInputElement;
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			set?.call(input, "#ops");
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
		});

		await act(async () => {
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		expect(mockAnswerMutate).toHaveBeenCalledWith(
			{
				id: THREAD,
				askId: "ask-input",
				answer: {
					kind: "input",
					values: { channel: "#ops" },
				},
			},
			expect.anything(),
		);
	});

	it("secret calls useAnswerSecret with value and never calls useAnswerAsk", async () => {
		const ask = baseAsk({
			askId: "ask-secret-id",
			kind: "secret",
			source: {
				kind: "tool",
				tool: "pl_secret_request",
				requestId: "ask-secret-id",
			},
			title: "GRAFANA_TOKEN",
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		const secretInput = q<HTMLInputElement>("ask-dock-secret");
		await act(async () => {
			const set = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			set?.call(secretInput, "secret-token-val");
			secretInput.dispatchEvent(new Event("input", { bubbles: true }));
			secretInput.dispatchEvent(new Event("change", { bubbles: true }));
		});

		const form = secretInput.closest("form");
		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		expect(mockSecretMutate).toHaveBeenCalledWith(
			{
				id: THREAD,
				requestId: "ask-secret-id",
				value: "secret-token-val",
			},
			expect.anything(),
		);
		expect(mockAnswerMutate).not.toHaveBeenCalled();
	});

	it("requiresHost: true renders Answer on the host machine and no button with text Allow once or Deny", async () => {
		const ask = baseAsk({
			askId: "ask-host",
			kind: "permission",
			requiresHost: true,
			permission: {
				toolKind: "execute",
				options: [
					{ optionId: "a", name: "Allow", kind: "allow_once" },
					{ optionId: "d", name: "Deny", kind: "reject_once" },
				],
			},
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		const hostNotice = q("ask-dock-host");
		expect(hostNotice.textContent).toBe("Answer on the host machine");
		expect(
			container.querySelector('[data-testid="ask-dock-allow"]'),
		).toBeNull();
		expect(container.querySelector('[data-testid="ask-dock-deny"]')).toBeNull();
	});

	it("requiresHost: true on the host's own session shows the Allow once and Deny buttons, no host notice", async () => {
		mockOnHost = true;
		const ask = baseAsk({
			askId: "ask-host-owner",
			kind: "permission",
			requiresHost: true,
			permission: {
				toolKind: "execute",
				options: [
					{ optionId: "a", name: "Allow", kind: "allow_once" },
					{ optionId: "d", name: "Deny", kind: "reject_once" },
				],
			},
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		expect(container.querySelector('[data-testid="ask-dock-host"]')).toBeNull();
		expect(q("ask-dock-allow").textContent).toContain("Allow");
		expect(q("ask-dock-deny").textContent).toContain("Deny");
	});

	it("three asks render 1 of 3 oldest first", async () => {
		const ask1 = baseAsk({
			askId: "ask-1",
			title: "First Oldest",
			openedAt: "2026-11-11T10:00:00.000Z",
		});
		const ask2 = baseAsk({
			askId: "ask-2",
			title: "Second",
			openedAt: "2026-11-11T10:05:00.000Z",
		});
		const ask3 = baseAsk({
			askId: "ask-3",
			title: "Third Latest",
			openedAt: "2026-11-11T10:10:00.000Z",
		});

		// Pass them scrambled
		await act(async () => {
			root.render(
				<AskDock
					asks={[ask3, ask1, ask2]}
					threadId={THREAD}
					agent="Claude Code"
				/>,
			);
		});

		expect(q("ask-dock-page").textContent).toBe("1 of 3");
		expect(q("ask-dock-title").textContent).toBe("First Oldest");
	});

	it("Escape hides the card without calling any mutate", async () => {
		const ask = baseAsk({
			askId: "ask-esc",
		});

		await act(async () => {
			root.render(
				<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />,
			);
		});

		const section = q("ask-dock");
		await act(async () => {
			section.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});

		expect(q("ask-dock-hidden")).not.toBeNull();
		expect(mockAnswerMutate).not.toHaveBeenCalled();
		expect(mockSecretMutate).not.toHaveBeenCalled();
	});
});
