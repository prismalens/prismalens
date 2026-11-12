// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, PendingAsk } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AskDock, DecidedList, decidedForYou } from "./AskDock";
import { decisionCopy } from "./decided.actions";

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
	it("marks what a command ask can reach beside the command: run, tinted warn", async () => {
		const ask = baseAsk({
			askId: "ask-reach",
			kind: "permission",
			permission: {
				toolKind: "execute",
				command: "rm -rf build",
				options: [{ optionId: "a", name: "Allow", kind: "allow_once" }],
			},
		});
		await act(async () => {
			root.render(
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
			);
		});
		const mark = q("ask-dock-reach");
		expect(mark.getAttribute("data-state")).toBe("run");
		expect(mark.getAttribute("aria-label")).toBe("Reach: Runs a command");
		expect(mark.querySelector("svg")?.getAttribute("class")).toContain(
			"text-warn",
		);
	});

	it("shows no reach mark on a question", async () => {
		const ask = baseAsk({
			questions: [
				{
					id: "q1",
					prompt: "Which?",
					multiSelect: false,
					allowOther: false,
					options: [{ id: "a", label: "A" }],
				},
			],
		});
		await act(async () => {
			root.render(
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
			);
		});
		expect(q("ask-dock-reach")).toBeNull();
	});

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
			);
		});

		const hostNotice = q("ask-dock-host");
		expect(hostNotice.textContent).toBe("Answer on the host machine");
		expect(
			container.querySelector('[data-testid="ask-dock-allow"]'),
		).toBeNull();
		expect(container.querySelector('[data-testid="ask-dock-deny"]')).toBeNull();
	});

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
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
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
			);
		});

		expect(container.querySelector('[data-testid="ask-dock-host"]')).toBeNull();
		expect(q("ask-dock-allow").textContent).toContain("Allow");
		expect(q("ask-dock-deny").textContent).toContain("Deny");
	});

	// 90f8ff442 tightens ask dock pager to compact "1/3" format and adds hint tooltips.
	it("three asks render 1/3 oldest first", async () => {
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
				<TooltipProvider>
					<AskDock
						asks={[ask3, ask1, ask2]}
						threadId={THREAD}
						agent="Claude Code"
					/>
				</TooltipProvider>,
			);
		});

		expect(q("ask-dock-page").textContent).toBe("1/3");
		expect(q("ask-dock-title").textContent).toBe("First Oldest");
	});

	// adaaf52a6 moves the ask reason into a hint, so AskDock renders inside TooltipProvider.
	it("Escape hides the card without calling any mutate", async () => {
		const ask = baseAsk({
			askId: "ask-esc",
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<AskDock asks={[ask]} threadId={THREAD} agent="Claude Code" />
				</TooltipProvider>,
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

describe("Decided for you (#1101)", () => {
	const answer = (
		askId: string,
		outcome: "allowed" | "mode_kept" | "unattended" | "approved",
		toolKind: string | null,
		title: string,
		ts: string,
	): CanonicalEvent => ({
		kind: "permission_answer",
		runId: THREAD,
		branchId: "main",
		path: [],
		seq: 1,
		ts,
		askId,
		outcome,
		title,
		toolKind,
	});
	const events: CanonicalEvent[] = [
		answer("a1", "allowed", "execute", "pnpm test", "2026-11-12T10:00:00.000Z"),
		answer(
			"a2",
			"allowed",
			"read",
			"Read src/pool.ts",
			"2026-11-12T10:01:00.000Z",
		),
		answer(
			"a3",
			"approved",
			"edit",
			"Edit src/pool.ts",
			"2026-11-12T10:02:00.000Z",
		),
		answer(
			"a4",
			"mode_kept",
			"switch_mode",
			"Switch to plan",
			"2026-11-12T10:03:00.000Z",
		),
		answer(
			"a5",
			"unattended",
			"execute",
			"rm -rf build",
			"2026-11-12T10:04:00.000Z",
		),
	];

	it("keeps the calls no person answered, newest first, and leaves out reads", () => {
		expect(decidedForYou(events)).toEqual([
			{
				key: "a5",
				at: "2026-11-12T10:04:00.000Z",
				title: "rm -rf build",
				toolKind: "execute",
				outcome: "blocked",
				why: "unattended",
			},
			{
				key: "a4",
				at: "2026-11-12T10:03:00.000Z",
				title: "Switch to plan",
				toolKind: "switch_mode",
				outcome: "blocked",
				why: "mode-kept",
			},
			{
				key: "a1",
				at: "2026-11-12T10:00:00.000Z",
				title: "pnpm test",
				toolKind: "execute",
				outcome: "approved",
				why: "mode",
			},
		]);
	});

	it("folds to approved and blocked counts, and opens to one row per call", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<DecidedList decided={decidedForYou(events)} />
				</TooltipProvider>,
			);
		});
		expect(q("decided-approved").textContent).toBe("1");
		expect(q("decided-blocked").textContent).toBe("2");
		expect(q("decided-toggle").getAttribute("aria-label")).toBe(
			"Decided for you: 1 approved, 2 blocked",
		);
		expect(q("decided-list")).toBeNull();
		await act(async () => q("decided-toggle").click());
		const rows = Array.from(
			container.querySelectorAll('[data-testid="decided-row"]'),
		).map((r) => [
			r.getAttribute("data-outcome"),
			r.querySelector(".font-mono")?.textContent,
		]);
		expect(rows).toEqual([
			["blocked", "rm -rf build"],
			["blocked", "Switch to plan"],
			["approved", "pnpm test"],
		]);
		expect(
			container
				.querySelector('[data-testid="decided-row"] [data-mark="decided"]')
				?.getAttribute("aria-label"),
		).toBe(
			"Decided for you: Blocked: an alert started this run and nobody was there",
		);
	});

	it("draws nothing when no call was decided for you", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<DecidedList decided={[]} />
				</TooltipProvider>,
			);
		});
		expect(q("decided")).toBeNull();
	});
});

describe("decision.copy (#1101)", () => {
	it("copies the decided call's title", async () => {
		const clip = await import("@/lib/clipboard");
		const spy = vi.spyOn(clip, "copyText").mockResolvedValue(true);
		decisionCopy.run({ title: "pnpm test --filter api", facts: {} });
		expect(spy).toHaveBeenCalledWith("pnpm test --filter api");
		spy.mockRestore();
	});
});
