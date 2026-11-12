// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconnectNow } from "@/lib/api/live-refresh";
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
	it("shows Interrupted by restart and default explanation, and Resume calls onResume", async () => {
		const onResume = vi.fn();
		await act(async () => root.render(<InterruptedDock onResume={onResume} />));

		const dock = container.querySelector('[data-testid="interrupted-dock"]');
		expect(dock?.textContent).toContain("Interrupted by restart");

		const next = container.querySelector(
			'[data-testid="interrupted-dock-next"]',
		);
		expect(next?.textContent).toBe(
			"PrismaLens stopped while this run worked. Resume picks up where it stopped.",
		);

		const resumeBtn = container.querySelector(
			'[data-testid="interrupted-dock-resume"]',
		) as HTMLButtonElement;
		expect(resumeBtn).not.toBeNull();
		await act(async () => {
			resumeBtn.click();
		});
		expect(onResume).toHaveBeenCalledTimes(1);
	});

	it("shows Not resumed: reason when notResumed is provided", async () => {
		const reason = "Resume after a restart is off in Settings.";
		await act(async () =>
			root.render(<InterruptedDock notResumed={reason} onResume={vi.fn()} />),
		);

		const next = container.querySelector(
			'[data-testid="interrupted-dock-next"]',
		);
		expect(next?.textContent).toBe(`Not resumed: ${reason}`);
	});
});

describe("ConnectionDock", () => {
	it("with fixedAsOf shows Connection lost, retrying. Your draft is kept and its Retry now button", async () => {
		const fixedAsOf = Date.parse("2026-11-12T15:30:00.000Z");
		await act(async () =>
			root.render(<ConnectionDock fixedAsOf={fixedAsOf} />),
		);

		const dock = container.querySelector('[data-testid="connection-dock"]');
		expect(dock).not.toBeNull();
		expect(dock?.textContent).toContain(
			"Connection lost, retrying. Your draft is kept",
		);

		const retryBtn = container.querySelector(
			'[data-testid="connection-dock-retry"]',
		) as HTMLButtonElement;
		expect(retryBtn).not.toBeNull();
		await act(async () => {
			retryBtn.click();
		});
		expect(reconnectNow).toHaveBeenCalledTimes(1);
	});
});
