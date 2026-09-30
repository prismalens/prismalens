// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { composerKeyAction, composerMode } from "./composer-keys";

const key = (k: string, mods: Partial<Record<string, boolean>> = {}) => ({
	key: k,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	isComposing: false,
	...mods,
});

describe("composerKeyAction", () => {
	it("queues on Enter and sends now on Ctrl or Cmd+Enter while live", () => {
		expect(composerKeyAction(key("Enter"), "live")).toBe("queue");
		expect(composerKeyAction(key("Enter", { ctrlKey: true }), "live")).toBe(
			"now",
		);
		expect(composerKeyAction(key("Enter", { metaKey: true }), "live")).toBe(
			"now",
		);
	});

	it("starts the run on Enter in brief and new-run modes", () => {
		expect(composerKeyAction(key("Enter"), "brief")).toBe("investigate");
		expect(composerKeyAction(key("Enter"), "again")).toBe("investigate");
		expect(composerKeyAction(key("Enter", { ctrlKey: true }), "brief")).toBe(
			"investigate",
		);
	});

	it("leaves Shift+Enter, IME composition and other keys to the field", () => {
		expect(composerKeyAction(key("Enter", { shiftKey: true }), "live")).toBe(
			null,
		);
		expect(composerKeyAction(key("Enter", { isComposing: true }), "live")).toBe(
			null,
		);
		expect(composerKeyAction(key("a"), "live")).toBe(null);
	});
});

describe("composerMode", () => {
	it("follows the selected run", () => {
		expect(composerMode(null)).toBe("brief");
		expect(composerMode({ live: true })).toBe("live");
		expect(composerMode({ live: false })).toBe("again");
	});
});

describe("resume mode (#747)", () => {
	it("sends on Enter and Ctrl+Enter like a live run", () => {
		expect(composerKeyAction(key("Enter"), "resume")).toBe("queue");
		expect(composerKeyAction(key("Enter", { ctrlKey: true }), "resume")).toBe(
			"now",
		);
	});

	it("is picked for an ended run that can be reopened, again otherwise", () => {
		expect(composerMode({ live: false, resumable: true })).toBe("resume");
		expect(composerMode({ live: false, resumable: false })).toBe("again");
		expect(composerMode({ live: true, resumable: true })).toBe("live");
	});
});
