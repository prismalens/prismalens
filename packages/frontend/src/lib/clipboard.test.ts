// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

// The toast's code is offline: its chunk import rejects.
vi.mock("./clipboard-toast", () => {
	throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => vi.restoreAllMocks());

describe("copyText with a blocked clipboard", () => {
	it("returns false and saves the text as its named file when the toast's code cannot load", async () => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: () => Promise.reject(new Error("denied")) },
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: () => false,
		});
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:copy");
		const saved: string[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			function (this: HTMLAnchorElement) {
				saved.push(`${this.download} ${this.href}`);
			},
		);

		expect([await copyText("pods restarted", "note.txt"), saved]).toEqual([
			false,
			["note.txt blob:copy"],
		]);
	});
});
