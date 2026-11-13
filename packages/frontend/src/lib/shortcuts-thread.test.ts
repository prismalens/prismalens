// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceEntries } from "@/components/kit/registry";
import type { ThreadCtx } from "@/components/shell/thread.actions";
import { threadHeader, threadRow } from "@/components/shell/thread.surface";
import { runActionKey, SHORTCUTS, setPageSurface } from "./shortcuts";

/** Every handler the tests press; a later field on ThreadCtx needs no change here. */
function ctx(is: ThreadCtx["facts"]["is"]): ThreadCtx {
	const f = vi.fn;
	return {
		rename: f(),
		nameAgain: f(),
		togglePin: f(),
		toggleArchive: f(),
		settle: f(),
		open: f(),
		openWithPanel: f(),
		copyTranscript: f(),
		copyLink: f(),
		fork: f(),
		aside: f(),
		facts: { is },
	} as ThreadCtx;
}
const key = (k: string, mods: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", { key: k, cancelable: true, ...mods });
const onPage = (c: ThreadCtx) =>
	setPageSurface({ id: "thread.header", ctx: () => c });

describe("thread action keys in the one registry (#1101 bar 20.1)", () => {
	afterEach(() => setPageSurface(null));

	it("ends the header menu with the row's actions in the same order", () => {
		// A phone header folds its own controls in first; the row's set closes its menu.
		const row = threadRow.menus.more ?? [];
		expect(threadHeader.menus.more?.slice(-row.length)).toEqual(row);
		expect(threadRow.menus.context).toEqual(threadRow.menus.more);
	});

	it("shows each action's key in the menu, Pin and Archive on Alt+Shift", () => {
		const rows = surfaceEntries(
			"thread.header",
			"more",
			ctx({ standalone: true, settleable: true, project: true }),
		).flatMap((e) =>
			"separator" in e || !e.keys ? [] : [`${e.label} ${e.keys}`],
		);
		expect(rows).toEqual([
			"Rename F2",
			"Pin Alt+Shift+P",
			"Fork here F",
			"Side question B",
			"Fork into a worktree W",
			"Copy link L",
			"Copy transcript T",
			"Settle S",
			"Archive Alt+Shift+A",
		]);
	});

	it("gives no two remappable shortcuts the same keys", () => {
		const keys = SHORTCUTS.filter((s) => !s.fixed).map((s) => s.keys);
		expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
	});

	it("runs F, B, Alt+Shift+P and Alt+Shift+A on the open thread", () => {
		const c = ctx({ standalone: true });
		onPage(c);
		const pressed = [
			key("f"),
			key("b"),
			key("P", { altKey: true, shiftKey: true, code: "KeyP" }),
			key("A", { altKey: true, shiftKey: true, code: "KeyA" }),
		].map((e) => runActionKey(e));
		expect(pressed).toEqual([true, true, true, true]);
		expect(c.fork).toHaveBeenCalledTimes(1);
		expect(c.aside).toHaveBeenCalledTimes(1);
		expect(c.togglePin).toHaveBeenCalledTimes(1);
		expect(c.toggleArchive).toHaveBeenCalledTimes(1);
	});

	it("leaves the second key of a g chord to the go shortcuts", () => {
		const c = ctx({ standalone: true, settleable: true });
		onPage(c);
		expect(runActionKey(key("g"))).toBe(false);
		expect(runActionKey(key("s"))).toBe(false);
		expect(c.settle).not.toHaveBeenCalled();
	});

	it("does not fork an incident thread: Fork here is disabled there", () => {
		const c = ctx({ standalone: false });
		onPage(c);
		expect(runActionKey(key("f"))).toBe(false);
		expect(c.fork).not.toHaveBeenCalled();
	});

	it("ignores keys typed into a field", () => {
		const c = ctx({ standalone: true });
		onPage(c);
		const input = document.createElement("textarea");
		document.body.appendChild(input);
		input.focus();
		expect(runActionKey(key("f"))).toBe(false);
		expect(c.fork).not.toHaveBeenCalled();
		input.remove();
	});
});
