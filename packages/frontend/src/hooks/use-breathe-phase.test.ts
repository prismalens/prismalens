// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM renderer in this package: run the hook's effect inline and keep its cleanup.
let cleanup: (() => void) | void;
vi.mock("react", () => ({
	useEffect: (fn: () => (() => void) | void) => {
		cleanup = fn();
	},
}));

import { useBreathePhase } from "./use-breathe-phase";

class FakeCSSAnimation {
	startTime: number | null = null;
	constructor(public animationName: string) {}
}

type Listener = (e: unknown) => void;
let listeners: Map<string, Listener>;
let setProperty: ReturnType<typeof vi.fn>;

beforeEach(() => {
	listeners = new Map();
	setProperty = vi.fn();
	vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
	vi.stubGlobal("Element", class {});
	vi.stubGlobal("document", {
		documentElement: { style: { setProperty } },
		addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
		removeEventListener: (type: string, fn: Listener) => {
			if (listeners.get(type) === fn) listeners.delete(type);
		},
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	cleanup = undefined;
});

function phaseAt(now: number): string {
	vi.spyOn(performance, "now").mockReturnValue(now);
	useBreathePhase();
	const call = setProperty.mock.calls.at(-1);
	expect(call?.[0]).toBe("--breathe-phase");
	return call?.[1] as string;
}

describe("useBreathePhase: the shared breathing clock", () => {
	it("sets the phase to minus performance.now() modulo 2400 ms", () => {
		expect(phaseAt(0)).toBe("0ms");
		expect(phaseAt(1000)).toBe("-1000ms");
		expect(phaseAt(2400)).toBe("0ms");
		expect(phaseAt(2400 * 7 + 350)).toBe("-350ms");
	});

	it("pins a started breathe animation to the document timeline", () => {
		phaseAt(10);
		const target = new (globalThis as unknown as { Element: new () => object })
			.Element() as Element;
		const breathe = new FakeCSSAnimation("pl-breathe");
		const other = new FakeCSSAnimation("pl-arrive");
		Object.assign(target, { getAnimations: () => [breathe, other] });
		breathe.startTime = 777;
		other.startTime = 777;
		listeners.get("animationstart")?.({ animationName: "pl-breathe", target });
		expect(breathe.startTime).toBe(0);
		expect(other.startTime).toBe(777);
	});

	it("ignores animations that are not breathing", () => {
		phaseAt(10);
		const getAnimations = vi.fn(() => []);
		const target = Object.assign(new (globalThis as { Element: new () => object }).Element(), {
			getAnimations,
		});
		listeners.get("animationstart")?.({ animationName: "pl-arrive", target });
		expect(getAnimations).not.toHaveBeenCalled();
	});

	it("removes its listener on cleanup", () => {
		phaseAt(10);
		expect(listeners.has("animationstart")).toBe(true);
		cleanup?.();
		expect(listeners.has("animationstart")).toBe(false);
	});
});
