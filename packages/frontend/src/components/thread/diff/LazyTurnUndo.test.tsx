// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LazyTurnUndo } from "./LazyTurnUndo";

const mockState = vi.hoisted(() => ({
	shouldFail: false,
}));

vi.mock("./TurnUndo", () => ({
	get TurnUndo() {
		if (mockState.shouldFail) {
			throw new Error("Failed to load TurnUndo");
		}
		return function MockTurnUndo() {
			return (
				<button type="button" data-testid="turn-undo">
					Mock Undo
				</button>
			);
		};
	},
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
const q = (id: string) =>
	container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
/** Each poll flushes React, so the lane's timer, the import and the transition can land. */
const until = (check: () => void) =>
	vi.waitFor(
		async () => {
			await act(async () => {});
			check();
		},
		{ timeout: 5_000, interval: 10 },
	);
let root: Root;

beforeEach(() => {
	mockState.shouldFail = false;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("LazyTurnUndo (#1181)", () => {
	it("shows loading state before resolving, shows retry on import rejection, and renders Undo on retry", async () => {
		// Holds place while loading and recovers from a failed import with retry.
		mockState.shouldFail = true;

		act(() => {
			root.render(<LazyTurnUndo runId="run-1" turnId={1} />);
		});

		const loading = container.querySelector(
			'[data-testid="turn-undo-loading"]',
		) as HTMLButtonElement | null;
		expect(loading).not.toBeNull();
		expect(loading?.disabled).toBe(true);

		await until(() => expect(q("turn-undo-retry")).not.toBeNull());
		expect(q("turn-undo-loading")).toBeNull();

		mockState.shouldFail = false;
		await act(async () => q("turn-undo-retry")?.click());

		await until(() => expect(q("turn-undo")?.textContent).toBe("Mock Undo"));
		expect(q("turn-undo-retry")).toBeNull();
	});
});
