// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextControl, contextHint } from "./ContextControl";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ label, children }: { label: string; children: ReactNode }) => (
		<span data-hint={label}>{children}</span>
	),
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
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

const button = () =>
	container.querySelector<HTMLButtonElement>('[data-testid="context-control"]');

describe("contextHint", () => {
	it("says in one sentence what the next send does, for Keep, Compact and an agent that can't compact", () => {
		expect(contextHint(261_000, false, true)).toBe(
			"Next send keeps all 261k tokens. Click to compact first.",
		);
		expect(contextHint(261_000, true, true)).toBe(
			"Next send compacts 261k tokens first. Click to keep them all.",
		);
		expect(contextHint(950, false, false)).toBe(
			"Next send keeps all 950 tokens; this agent can't compact.",
		);
	});
});

describe("ContextControl", () => {
	it("a click toggles to Compact, and a long press opens the breakdown without toggling", async () => {
		const onCompact = vi.fn();
		const onBreakdown = vi.fn();
		await act(async () =>
			root.render(
				<ContextControl
					choice={{ used: 261_000, canCompact: true }}
					compact={false}
					onCompact={onCompact}
					onBreakdown={onBreakdown}
				/>,
			),
		);
		expect(button()?.closest("[data-hint]")?.getAttribute("data-hint")).toBe(
			"Next send keeps all 261k tokens. Click to compact first.",
		);
		await act(async () => button()?.click());
		expect(onCompact).toHaveBeenCalledWith(true);

		onCompact.mockClear();
		await act(async () => {
			button()?.dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true }),
			);
			vi.advanceTimersByTime(500);
			button()?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
			button()?.click();
		});
		expect(onBreakdown).toHaveBeenCalledTimes(1);
		expect(onCompact).not.toHaveBeenCalled();
	});

	it("right-click opens the breakdown", async () => {
		const onBreakdown = vi.fn();
		await act(async () =>
			root.render(
				<ContextControl
					choice={{ used: 1_200, canCompact: true }}
					compact
					onCompact={() => {}}
					onBreakdown={onBreakdown}
				/>,
			),
		);
		expect(button()?.textContent).toBe("Compact1k");
		await act(async () => {
			button()?.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
			);
		});
		expect(onBreakdown).toHaveBeenCalledTimes(1);
	});
});
