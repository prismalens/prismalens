// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePersistedState } from "./use-persisted-state";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	window.localStorage.clear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function TestHarness({
	storageKey,
	fallback,
	onReady,
}: {
	storageKey: string;
	fallback: string;
	onReady: (val: string, setVal: (v: string) => void) => void;
}) {
	const [val, setVal] = usePersistedState(storageKey, fallback);
	onReady(val, setVal);
	return createElement("div", { "data-testid": "value" }, val);
}

describe("usePersistedState (#1024)", () => {
	it("a value survives an unmount and remount under the same key", async () => {
		let currentVal = "";
		let setFn!: (v: string) => void;

		await act(async () => {
			root.render(
				createElement(TestHarness, {
					storageKey: "pref.color",
					fallback: "blue",
					onReady: (v, s) => {
						currentVal = v;
						setFn = s;
					},
				}),
			);
		});
		expect(currentVal).toBe("blue");

		await act(async () => {
			setFn("emerald");
		});
		expect(currentVal).toBe("emerald");

		await act(async () => {
			root.unmount();
		});

		root = createRoot(container);
		let remountVal = "";
		await act(async () => {
			root.render(
				createElement(TestHarness, {
					storageKey: "pref.color",
					fallback: "blue",
					onReady: (v) => {
						remountVal = v;
					},
				}),
			);
		});
		expect(remountVal).toBe("emerald");
	});

	it("a localStorage whose getItem/setItem throw still renders the fallback and updates in memory", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("QuotaExceeded or SecurityError");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("QuotaExceeded or SecurityError");
		});

		let currentVal = "";
		let setFn!: (v: string) => void;

		await act(async () => {
			root.render(
				createElement(TestHarness, {
					storageKey: "failing.key",
					fallback: "fallback-text",
					onReady: (v, s) => {
						currentVal = v;
						setFn = s;
					},
				}),
			);
		});
		expect(currentVal).toBe("fallback-text");
		expect(container.querySelector('[data-testid="value"]')?.textContent).toBe(
			"fallback-text",
		);

		await act(async () => {
			setFn("memory-updated");
		});
		expect(currentVal).toBe("memory-updated");
		expect(container.querySelector('[data-testid="value"]')?.textContent).toBe(
			"memory-updated",
		);
	});
});
