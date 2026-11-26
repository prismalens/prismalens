// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckAllButton, CheckTimes, safeCheck } from "./agent-checks";

const mocks = vi.hoisted(() => ({
	mutate: vi.fn(),
	state: { isPending: false, isSuccess: false },
}));

vi.mock("@/lib/api/hooks", () => ({
	useCheckAllHarnesses: () => ({ mutate: mocks.mutate, ...mocks.state }),
}));

vi.mock("@prismalens/config/harness", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("@prismalens/config/harness")>();
	return {
		...real,
		HARNESS_REGISTRY: {
			...real.HARNESS_REGISTRY,
			codex: { ...real.HARNESS_REGISTRY.codex, probeIsolation: {} },
			cursor: { ...real.HARNESS_REGISTRY.cursor, probeIsolation: undefined },
		},
	};
});

const agent = (
	id: string,
	label: string,
	checked: HarnessStatus["checked"] = null,
): HarnessStatus =>
	({
		id,
		label,
		installed: true,
		off: false,
		checked,
	}) as unknown as HarnessStatus;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-11-26T10:10:00Z"));
	mocks.mutate.mockReset();
	mocks.state = { isPending: false, isSuccess: false };
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.useRealTimers();
});
const render = (el: React.ReactElement) => act(() => root.render(el));
const text = (id: string) =>
	host.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

describe("agent checks in Settings (#1180 §1.4)", () => {
	it("safeCheck holds only for an agent whose row has a check isolation", () => {
		expect(safeCheck("codex")).toBe(true);
		expect(safeCheck("cursor")).toBe(false);
	});

	it("shows Checked 3m ago, and Last try failed 1m ago when a newer try failed", () => {
		render(
			<CheckTimes
				agent={agent("codex", "Codex", {
					at: "2026-11-26T10:07:00Z",
					lastTry: {
						at: "2026-11-26T10:09:00Z",
						outcome: "no-answer",
						detail: "no answer",
					},
				} as HarnessStatus["checked"])}
			/>,
		);
		expect(text("agent-checked-codex")).toBe("Checked 3m ago");
		expect(text("agent-tried-codex")).toBe("Last try failed 1m ago");
	});

	it("leaves out a failed try older than the kept check", () => {
		render(
			<CheckTimes
				agent={agent("codex", "Codex", {
					at: "2026-11-26T10:07:00Z",
					lastTry: {
						at: "2026-11-26T10:00:00Z",
						outcome: "no-answer",
						detail: "no answer",
					},
				} as HarnessStatus["checked"])}
			/>,
		);
		expect(text("agent-checked-codex")).toBe("Checked 3m ago");
		expect(text("agent-tried-codex")).toBeNull();
	});

	it("Check all runs the check, then names each agent it did not start", () => {
		const agents = [agent("codex", "Codex"), agent("cursor", "Cursor")];
		render(<CheckAllButton agents={agents} />);
		act(() =>
			(
				host.querySelector(
					'[data-testid="agent-check-all"]',
				) as HTMLButtonElement
			).click(),
		);
		expect(mocks.mutate).toHaveBeenCalledTimes(1);
		expect(text("agent-check-all-skipped")).toBeNull();
		mocks.state = { isPending: false, isSuccess: true };
		render(<CheckAllButton agents={agents} />);
		expect(text("agent-check-all-skipped")).toBe(
			"Not checked: no safe check: Cursor",
		);
	});

	it("Check all is off when no installed agent has a safe check", () => {
		render(<CheckAllButton agents={[agent("cursor", "Cursor")]} />);
		const button = host.querySelector(
			'[data-testid="agent-check-all"]',
		) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.textContent).toBe("Check all");
	});
});
