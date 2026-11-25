// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "@/hooks/use-toast";
import { copyPending, copyText } from "./clipboard";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The toast's code is offline: its chunk import rejects.
vi.mock("./clipboard-toast", () => {
	throw new Error("Failed to fetch dynamically imported module");
});

let saved: string[];
let shown: () => string[];
let unmount: () => Promise<void>;

beforeEach(async () => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: () => Promise.reject(new Error("denied")),
			write: () => Promise.reject(new Error("denied")),
		},
	});
	Object.defineProperty(document, "execCommand", {
		configurable: true,
		value: () => false,
	});
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:copy");
	saved = [];
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
		function (this: HTMLAnchorElement) {
			saved.push(`${this.download} ${this.href}`);
		},
	);
	// What the toast store holds, read the way the toast layer reads it.
	let toasts: string[] = [];
	function Reader() {
		toasts = useToast().toasts.map((t) => `${t.title}: ${t.description}`);
		return null;
	}
	const el = document.createElement("div");
	const root = createRoot(el);
	await act(async () => root.render(createElement(Reader)));
	shown = () => toasts;
	unmount = () => act(async () => root.unmount());
});

afterEach(async () => {
	await unmount();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("a blocked copy whose toast code cannot load", () => {
	it("returns false, saves the text as its named file and says so in a plain toast", async () => {
		let ok: boolean | undefined;
		await act(async () => {
			ok = await copyText("pods restarted", "note.txt");
		});
		expect([ok, saved, shown()]).toEqual([
			false,
			["note.txt blob:copy"],
			[
				"Not copied: The browser kept the clipboard closed, so PrismaLens saved the text as a file.",
			],
		]);
	});

	it("returns false, saves nothing and says the text did not load when there is no text", async () => {
		// Without ClipboardItem the pending text is awaited inside the write, so its failure is the copy's.
		vi.stubGlobal("ClipboardItem", undefined);
		let ok: boolean | undefined;
		await act(async () => {
			ok = await copyPending(Promise.reject(new Error("offline")));
		});
		expect([ok, saved, shown()]).toEqual([
			false,
			[],
			["Not copied: PrismaLens couldn't load the text to copy. Try again."],
		]);
	});
});
