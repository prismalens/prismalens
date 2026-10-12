// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "@/lib/format-time";
import type { AskRecord } from "@/lib/run-asks";
import { RunDock } from "./RunDock";

const mutateSpy = vi.fn();
let answerError: { code: string } | null = null;

vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
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
