// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
	bindingOf,
	chordTarget,
	comboFromEvent,
	matches,
	parseKeys,
	setRemaps,
	takenBy,
} from "./shortcuts";

describe("shortcuts", () => {
	beforeEach(() => {
		setRemaps({});
		Object.defineProperty(navigator, "platform", {
			value: "Linux x86_64",
			configurable: true,
		});
	});

	it("parseKeys parses valid combos, chords, and rejects junk", () => {
		// Valid single combo
		const single = parseKeys("Mod+K");
		expect(single).toEqual([
			{ mod: true, ctrl: false, shift: false, alt: false, key: "k" },
		]);

		// Valid chord
		const chord = parseKeys("G T");
		expect(chord).toEqual([
			{ mod: false, ctrl: false, shift: false, alt: false, key: "g" },
			{ mod: false, ctrl: false, shift: false, alt: false, key: "t" },
		]);

		// Junk: empty, >2 keys, or invalid modifier
		expect(parseKeys("")).toBe(null);
		expect(parseKeys("A B C")).toBe(null);
		expect(parseKeys("Unknown+K")).toBe(null);
		expect(parseKeys("Ctrl+")).toBe(null);
	});

	it("matches for Mod+K matches Ctrl+k on a non-Mac platform", () => {
		Object.defineProperty(navigator, "platform", {
			value: "Linux x86_64",
			configurable: true,
		});

		const ctrlK = new KeyboardEvent("keydown", {
			key: "k",
			ctrlKey: true,
			metaKey: false,
		});
		expect(matches(ctrlK, "search")).toBe(true);

		const metaK = new KeyboardEvent("keydown", {
			key: "k",
			ctrlKey: false,
			metaKey: true,
		});
		expect(matches(metaK, "search")).toBe(false);
	});

	it("matches Ctrl+` by e.code Backquote", () => {
		const backquote = new KeyboardEvent("keydown", {
			key: "Dead",
			code: "Backquote",
			ctrlKey: true,
		});
		expect(matches(backquote, "terminal")).toBe(true);
	});

	it("matches ? with Shift held", () => {
		const question = new KeyboardEvent("keydown", {
			key: "?",
			shiftKey: true,
		});
		expect(matches(question, "help")).toBe(true);
	});

	it("matches C not matching when Ctrl is held", () => {
		const ctrlC = new KeyboardEvent("keydown", {
			key: "c",
			ctrlKey: true,
		});
		expect(matches(ctrlC, "new-incident")).toBe(false);

		const plainC = new KeyboardEvent("keydown", {
			key: "c",
		});
		expect(matches(plainC, "new-incident")).toBe(true);
	});

	it("setRemaps ignores fixed id and unknown id, and bindingOf returns the remap", () => {
		expect(bindingOf("search")).toBe("Mod+K");
		expect(bindingOf("list-open")).toBe("Enter");

		setRemaps({
			search: "Mod+P",
			"list-open": "Space", // fixed: true
			"unknown-id": "Mod+U", // unknown
		});

		expect(bindingOf("search")).toBe("Mod+P");
		expect(bindingOf("list-open")).toBe("Enter");
		expect(bindingOf("unknown-id")).toBe("");
	});

	it("chordTarget('G', ...) finds go.threads for t", () => {
		const eventT = new KeyboardEvent("keydown", {
			key: "t",
		});
		expect(chordTarget("G", eventT)).toBe("go.threads");

		const eventZ = new KeyboardEvent("keydown", {
			key: "z",
		});
		expect(chordTarget("G", eventZ)).toBe(null);
	});

	it("comboFromEvent returns null for lone Shift, and Mod+Shift+O on non-Mac for Ctrl+Shift+o", () => {
		Object.defineProperty(navigator, "platform", {
			value: "Linux x86_64",
			configurable: true,
		});

		const loneShift = new KeyboardEvent("keydown", {
			key: "Shift",
			shiftKey: true,
		});
		expect(comboFromEvent(loneShift)).toBe(null);

		const ctrlShiftO = new KeyboardEvent("keydown", {
			key: "o",
			ctrlKey: true,
			shiftKey: true,
		});
		expect(comboFromEvent(ctrlShiftO)).toBe("Mod+Shift+O");
	});

	it("takenBy finds a clash", () => {
		const clash = takenBy("Mod+K", "new-incident");
		expect(clash?.id).toBe("search");

		const noClash = takenBy("Mod+K", "search");
		expect(noClash).toBe(null);
	});
});
