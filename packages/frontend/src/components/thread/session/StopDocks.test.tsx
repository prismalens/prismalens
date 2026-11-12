// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { reconnectNow } from "@/lib/api/live-refresh";
import { formatClock } from "@/lib/format-time";
import { ConnectionDock, InterruptedDock } from "./StopDocks";

vi.mock("@/lib/api/live-refresh", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/api/live-refresh")>();
	return {
		...actual,
		reconnectNow: vi.fn(),
	};
});

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
	vi.clearAllMocks();
});

describe("InterruptedDock", () => {
	// 14d81ef5f moves the reason into a hint, so the dock renders inside TooltipProvider.
	it("shows Interrupted by restart, and Resume calls onResume", async () => {
		const onResume = vi.fn();
		await act(async () =>
			root.render(
				<TooltipProvider>
					<InterruptedDock onResume={onResume} />
				</TooltipProvider>,
			),
		);

		const dock = container.querySelector('[data-testid="interrupted-dock"]');
		expect(dock?.textContent).toContain("Interrupted by restart");

		const next = container.querySelector(
			'[data-testid="interrupted-dock-next"]',
		);
		expect(next).toBeNull();

		const resumeBtn = container.querySelector(
			'[data-testid="interrupted-dock-resume"]',
		) as HTMLButtonElement;
		expect(resumeBtn).not.toBeNull();
		expect(resumeBtn.textContent).toBe("Resume");
		await act(async () => {
			resumeBtn.click();
		});
		expect(onResume).toHaveBeenCalledTimes(1);
	});

	// 14d81ef5f moves the reason into a hint, so the dock renders inside TooltipProvider.
	it("shows Not resumed when notResumed is provided", async () => {
		const reason = "Resume after a restart is off in Settings.";
		await act(async () =>
			root.render(
				<TooltipProvider>
					<InterruptedDock notResumed={reason} onResume={vi.fn()} />
				</TooltipProvider>,
			),
		);

		const next = container.querySelector(
			'[data-testid="interrupted-dock-next"]',
		);
		expect(next?.textContent).toBe("Not resumed");
	});
});

describe("ConnectionDock", () => {
	// 14d81ef5f moves the reason into a hint, so the dock renders inside TooltipProvider.
	it("with fixedAsOf shows Reconnecting, As of time and its Retry now button", async () => {
		const fixedAsOf = Date.parse("2026-11-12T15:30:00.000Z");
		await act(async () =>
			root.render(
				<TooltipProvider>
					<ConnectionDock fixedAsOf={fixedAsOf} />
				</TooltipProvider>,
			),
		);

		const dock = container.querySelector('[data-testid="connection-dock"]');
		expect(dock).not.toBeNull();
		expect(dock?.textContent).toContain("Reconnecting");
		expect(dock?.textContent).toContain(`As of ${formatClock(fixedAsOf)}`);

		const retryBtn = container.querySelector(
			'[data-testid="connection-dock-retry"]',
		) as HTMLButtonElement;
		expect(retryBtn).not.toBeNull();
		expect(retryBtn.textContent).toBe("Retry now");
		await act(async () => {
			retryBtn.click();
		});
		expect(reconnectNow).toHaveBeenCalledTimes(1);
	});
});
