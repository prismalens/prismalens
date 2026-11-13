// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceEntries } from "@/components/kit/registry";
import type { ThreadCtx } from "./thread.actions";
import { threadHeader, threadRow } from "./thread.surface";
import { installThreadKeys, onThreadKey, setPageThread } from "./thread-keys";

/** Every handler the tests press; a later field on ThreadCtx needs no change here. */
function ctx(is: ThreadCtx["facts"]["is"]): ThreadCtx {
	const f = vi.fn;
	return {
		rename: f(),
		// Name it again joins the menus further up the stack (#1101 category 20).
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
const key = (k: string) =>
	new KeyboardEvent("keydown", { key: k, cancelable: true });

describe("thread action keys (#1101 bar 20.1)", () => {
	afterEach(() => setPageThread(null));

	it("gives the row and the header the same actions in the same order", () => {
		expect(threadHeader.menus.more).toEqual(threadRow.menus.more);
		expect(threadRow.menus.context).toEqual(threadRow.menus.more);
	});

	it("shows each action's key in the menu", () => {
		installThreadKeys();
		const rows = surfaceEntries(
			"thread.header",
			"more",
			ctx({ standalone: true, settleable: true, project: true }),
		).flatMap((e) =>
			"separator" in e || !e.keys ? [] : [`${e.label} ${e.keys}`],
		);
		expect(rows).toEqual([
			"Rename F2",
			"Pin P",
			"Fork here F",
			"Side question B",
			"Fork into a worktree W",
			"Copy link L",
			"Copy transcript T",
			"Settle S",
			"Archive E",
		]);
	});

	it("runs P, F, B and E on the open thread", () => {
		const c = ctx({ standalone: true });
		setPageThread(() => c);
		for (const k of ["p", "f", "b", "e"]) expect(onThreadKey(key(k))).toBe(true);
		expect(c.togglePin).toHaveBeenCalledTimes(1);
		expect(c.fork).toHaveBeenCalledTimes(1);
		expect(c.aside).toHaveBeenCalledTimes(1);
		expect(c.toggleArchive).toHaveBeenCalledTimes(1);
	});

	it("leaves the second key of a g chord to the go shortcuts", () => {
		const c = ctx({ standalone: true, settleable: true });
		setPageThread(() => c);
		expect(onThreadKey(key("g"))).toBe(false);
		expect(onThreadKey(key("s"))).toBe(false);
		expect(c.settle).not.toHaveBeenCalled();
	});

	it("does not fork an incident thread: Fork here is disabled there", () => {
		const c = ctx({ standalone: false });
		setPageThread(() => c);
		expect(onThreadKey(key("f"))).toBe(false);
		expect(c.fork).not.toHaveBeenCalled();
	});

	it("ignores keys typed into a field", () => {
		const c = ctx({ standalone: true });
		setPageThread(() => c);
		const input = document.createElement("textarea");
		document.body.appendChild(input);
		input.focus();
		expect(onThreadKey(key("p"))).toBe(false);
		expect(c.togglePin).not.toHaveBeenCalled();
		input.remove();
	});
});
