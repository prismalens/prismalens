// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatClock } from "@/lib/format-time";
import type { AskRecord } from "@/lib/run-asks";
import { type QueuedCtx, queuedEdit, queuedWithdraw } from "./message.actions";
import { RunDock } from "./RunDock";

const mutateSpy = vi.fn();
const withdrawSpy = vi.fn();
const editSpy = vi.fn();
const entriesSpy = vi.fn((..._args: unknown[]) => []);

vi.mock("@/components/kit/registry", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/kit/registry")>()),
	surfaceEntries: (...args: unknown[]) => entriesSpy(...args),
}));
let answerError: { code: string } | null = null;

vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useWithdrawQueuedMessage: () => ({ mutate: withdrawSpy, isPending: false }),
	useEditQueuedMessage: () => ({ mutate: editSpy, isPending: false }),
	useAnswerAsk: () => ({
		mutate: mutateSpy,
		isPending: false,
		isSuccess: false,
		isError: answerError !== null,
		error: answerError,
	}),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.useFakeTimers();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	mutateSpy.mockClear();
	withdrawSpy.mockClear();
	editSpy.mockClear();
	entriesSpy.mockClear();
	answerError = null;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

const ask = (n: number, over: Partial<AskRecord> = {}): AskRecord => ({
	askId: `00000000-0000-0000-0000-00000000000${n}`,
	title: `curl -s http://localhost:909${n}/`,
	detail: `curl -s http://localhost:909${n}/`,
	input: null,
	server: null,
	at: "2026-10-09T10:00:00Z",
	expiresAt: "2026-10-09T10:10:00Z",
	clamped: false,
	state: "waiting",
	...over,
});

const render = (asks: AskRecord[], onStep?: (n: number) => void) =>
	act(async () => {
		root.render(
			<RunDock
				asks={asks}
				queued={[]}
				runId="run-1"
				agent="Claude Code"
				onStep={onStep}
			/>,
		);
	});
const button = (id: string) =>
	container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
const settle = () => act(async () => vi.advanceTimersByTime(700));

describe("RunDock queued messages", () => {
	const renderQueued = (
		queued: { key: string; messageId?: string; text: string }[],
	) =>
		act(async () => {
			root.render(
				<TooltipProvider>
					<RunDock
						asks={[]}
						queued={queued.map((q) => ({ ...q, attachments: [] }))}
						runId="run-1"
						agent="Claude Code"
					/>
				</TooltipProvider>,
			);
		});

	// The kit registry is empty under vitest: the row's context is captured and its actions run directly.
	const ctxOf = (n: number) => entriesSpy.mock.calls[n]?.[2] as QueuedCtx;

	it("marks each queued message with its place in the queue (#1101)", async () => {
		await renderQueued([
			{ key: "local-1", messageId: "srv-1", text: "check the pool" },
			{ key: "local-2", text: "and the TTL" },
		]);
		const marks = Array.from(
			container.querySelectorAll('[data-mark="delivery"]'),
		).map((m) => m.getAttribute("aria-label"));
		expect(marks).toEqual([
			"Delivery: Queued 1 of 2: waits for the agent's next pause",
			"Delivery: Queued 2 of 2: waits for the agent's next pause",
		]);
	});

	it("a message the API has not answered yet cannot be edited or withdrawn", async () => {
		await renderQueued([{ key: "local-1", text: "check the pool" }]);
		const facts = ctxOf(0).facts;
		expect(queuedEdit.disabled?.(facts)).toBe("Not saved yet");
		expect(queuedWithdraw.disabled?.(facts)).toBe("Not saved yet");
	});

	it("Withdraw sends the server's message id, not the row's local key", async () => {
		await renderQueued([
			{ key: "local-1", messageId: "srv-1", text: "check the pool" },
		]);
		const ctx = ctxOf(0);
		expect(queuedWithdraw.disabled?.(ctx.facts)).toBe(false);
		queuedWithdraw.run(ctx);
		expect(withdrawSpy).toHaveBeenCalledTimes(1);
		expect(withdrawSpy.mock.calls[0]?.[0]).toEqual({
			id: "run-1",
			messageId: "srv-1",
		});
	});

	it("Edit opens the message's text in a field", async () => {
		await renderQueued([
			{ key: "local-1", messageId: "srv-1", text: "check the pool" },
		]);
		await act(async () => queuedEdit.run(ctxOf(0)));
		const field = container.querySelector(
			'input[aria-label="Queued message"]',
		) as HTMLInputElement | null;
		expect(field?.value).toBe("check the pool");
	});
});

describe("RunDock asks (#820, #673 w5-43)", () => {
	it("answers the oldest ask with Approve or Deny", async () => {
		await render([ask(1), ask(2)]);
		await settle();
		expect(
			container.querySelector('[data-testid="dock-ask-count"]')?.textContent,
		).toBe("1 of 2");
		await act(async () => button("ask-approve")?.click());
		expect(mutateSpy).toHaveBeenCalledWith({
			id: "run-1",
			askId: ask(1).askId,
			decision: "approve",
		});
		await render([ask(2)]);
		await settle();
		await act(async () => button("ask-deny")?.click());
		expect(mutateSpy).toHaveBeenLastCalledWith({
			id: "run-1",
			askId: ask(2).askId,
			decision: "deny",
		});
	});

	it("never lets one press answer the next ask: focus moves to what it asks, and the buttons wait", async () => {
		await render([ask(1), ask(2)]);
		await settle();
		await act(async () => button("ask-approve")?.click());
		await render([ask(2)]);
		expect(document.activeElement?.getAttribute("data-testid")).toBe(
			"dock-ask-title",
		);
		expect(button("ask-approve")?.disabled).toBe(true);
		await act(async () => button("ask-approve")?.click());
		expect(mutateSpy).toHaveBeenCalledTimes(1);
	});

	it("says the ask is gone only on CONFLICT; any other failure asks for a retry", async () => {
		answerError = { code: "CONFLICT" };
		await render([ask(1)]);
		expect(container.textContent).toContain("That ask is no longer waiting.");
		answerError = { code: "TOO_MANY_REQUESTS" };
		await render([ask(1)]);
		expect(container.textContent).toContain(
			"Your answer did not reach the run. Try again.",
		);
	});

	it("says when an unanswered ask is denied, or the run's limit cuts it short", async () => {
		await render([ask(1)]);
		expect(container.textContent).toContain(
			`Denied at ${formatClock(ask(1).expiresAt)} if no one answers`,
		);
		await render([ask(1, { clamped: true })]);
		expect(container.textContent).toContain(
			`The run's time limit is near, so this ask expires at ${formatClock(ask(1).expiresAt)}`,
		);
	});

	it("shows an MCP tool by name and server, with its input (#673 w5-41)", async () => {
		await render([
			ask(1, {
				title: "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
				detail: null,
				input: '{\n  "commands": [\n    "git log -5"\n  ]\n}',
				server: "context-mode",
			}),
		]);
		expect(
			container.querySelector('[data-testid="dock-ask-title"]')?.textContent,
		).toBe("ctx_batch_execute, a tool from the context-mode MCP server");
		expect(
			container.querySelector('[data-testid="dock-ask-detail"]')?.textContent,
		).toContain('"git log -5"');
	});

	it("rings the ask's step", async () => {
		const onStep = vi.fn();
		await render([ask(1, { step: 4 })], onStep);
		await act(async () => button("dock-ask-step")?.click());
		expect(onStep).toHaveBeenCalledWith(4);
	});
});

describe("Always allow on a schedule's run (#1020)", () => {
	it("is offered only on a schedule's run, and remembers the ask for its next runs", async () => {
		await render([ask(1)]);
		expect(button("ask-always")).toBeNull();
		await act(async () => {
			root.render(
				<RunDock
					asks={[ask(4)]}
					queued={[]}
					runId="run-1"
					agent="Claude Code"
					always
				/>,
			);
		});
		await settle();
		// An ask nothing stable names cannot be remembered, so it offers no Always allow (CP4 OBJ-011).
		expect(button("ask-always")).toBeNull();
		await act(async () => {
			root.render(
				<RunDock
					asks={[{ ...ask(3), identity: "a".repeat(64) }]}
					queued={[]}
					runId="run-1"
					agent="Claude Code"
					always
				/>,
			);
		});
		await settle();
		await act(async () => button("ask-always")?.click());
		expect(mutateSpy).toHaveBeenLastCalledWith({
			id: "run-1",
			askId: ask(3).askId,
			decision: "approve",
			always: true,
		});
	});
});
