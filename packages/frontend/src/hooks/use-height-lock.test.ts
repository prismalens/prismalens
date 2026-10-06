// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
	useRef: <T>(v: T) => ({ current: v }),
	useCallback: <T>(fn: T) => fn,
}));

import { useHeightLock } from "./use-height-lock";

let observers: FakeObserver[];
class FakeObserver {
	disconnected = false;
	constructor(private cb: () => void) {
		observers.push(this);
	}
	observe() {}
	disconnect() {
		this.disconnected = true;
	}
	fire() {
		this.cb();
	}
}

function dialog(height: number) {
	return { offsetHeight: height, style: { minHeight: "" } } as unknown as HTMLElement & {
		offsetHeight: number;
	};
}

beforeEach(() => {
	observers = [];
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("window", { innerHeight: 1000 });
});
afterEach(() => vi.unstubAllGlobals());

describe("useHeightLock: a dialog's height never shrinks while it is open", () => {
	it("locks min-height at the tallest content it has shown", () => {
		const node = dialog(300);
		useHeightLock<HTMLElement>(null)(node);
		observers[0]?.fire();
		expect(node.style.minHeight).toBe("300px");
		(node as { offsetHeight: number }).offsetHeight = 420;
		observers[0]?.fire();
		expect(node.style.minHeight).toBe("420px");
	});

	it("does not shrink when the content does (a switch flips, a validation line clears)", () => {
		const node = dialog(420);
		useHeightLock<HTMLElement>(null)(node);
		observers[0]?.fire();
		(node as { offsetHeight: number }).offsetHeight = 250;
		observers[0]?.fire();
		expect(node.style.minHeight).toBe("420px");
	});

	it("caps the lock at 80% of the viewport, where the dialog scrolls inside", () => {
		const node = dialog(2000);
		useHeightLock<HTMLElement>(null)(node);
		observers[0]?.fire();
		expect(node.style.minHeight).toBe("800px");
	});

	it("hands the node to a function ref and an object ref", () => {
		const fn = vi.fn();
		const node = dialog(100);
		useHeightLock<HTMLElement>(fn)(node);
		expect(fn).toHaveBeenCalledWith(node);
		const obj = { current: null as HTMLElement | null };
		useHeightLock<HTMLElement>(obj)(node);
		expect(obj.current).toBe(node);
	});

	it("stops observing when the node unmounts", () => {
		const ref = useHeightLock<HTMLElement>(null);
		ref(dialog(100));
		ref(null);
		expect(observers[0]?.disconnected).toBe(true);
	});
});
