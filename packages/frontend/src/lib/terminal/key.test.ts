// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeTerminalKey, terminalKey } from "./key";

afterEach(() => vi.unstubAllGlobals());

describe("the desktop terminal key arriving late (#931)", () => {
	it("tells a subscriber when main stores a claimed key, and stops when released", () => {
		let key: string | undefined;
		let notify = () => {};
		const off = vi.fn();
		vi.stubGlobal("window", {
			prismalensDesktop: {
				platform: "win32",
				setTheme: () => {},
				terminalKey: () => key,
				onTerminalKey: (listener: () => void) => {
					notify = listener;
					return off;
				},
			},
		});
		const seen: Array<string | undefined> = [];
		const release = subscribeTerminalKey(() => seen.push(terminalKey()));
		expect(terminalKey()).toBeUndefined();
		key = "tk";
		notify();
		expect(seen).toEqual(["tk"]);
		release();
		expect(off).toHaveBeenCalled();
	});

	it("is a no-op in a browser or an older desktop build", () => {
		vi.stubGlobal("window", {});
		expect(subscribeTerminalKey(() => {})()).toBeUndefined();
		vi.stubGlobal("window", {
			prismalensDesktop: { platform: "win32", setTheme: () => {} },
		});
		expect(subscribeTerminalKey(() => {})()).toBeUndefined();
	});
});
