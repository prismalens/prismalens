// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveSurface } from "@/components/kit/registry";
import type { SampleCtx } from "@/design/sample.actions";
import { type Shortcut, runActionKey, shortcutForAction } from "./shortcuts";

/** The gallery's sample surface, bound to Ctrl+F through the `app.find` shortcut. */
const BOUND: Shortcut[] = [
	{
		id: "app.find",
		label: "Find in the thread",
		group: "Thread",
		keys: "Mod+F",
		action: "sample.copy",
	},
];

const ctrlF = () =>
	new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true });

function mountSurface(ctx: SampleCtx) {
	const el = document.createElement("div");
	el.dataset.surface = "sample.row";
	const button = document.createElement("button");
	el.append(button);
	document.body.append(el);
	setActiveSurface({ id: "sample.row", ctx: () => ctx });
	return button;
}

afterEach(() => {
	setActiveSurface(null);
	document.body.innerHTML = "";
});

describe("shortcuts bound to registry actions (#1125)", () => {
	it("finds the shortcut bound to an action, and none for an unbound one", () => {
		expect(shortcutForAction("sample.copy", BOUND)?.id).toBe("app.find");
		expect(shortcutForAction("sample.stop", BOUND)).toBe(undefined);
	});

	it("runs sample.copy on Ctrl+F when focus is inside the sample surface", () => {
		const log = vi.fn();
		mountSurface({ command: "kubectl get pods", facts: {}, log }).focus();
		expect(runActionKey(ctrlF(), BOUND)).toBe(true);
		expect(log.mock.calls).toEqual([["copy kubectl get pods"]]);
	});

	it("runs nothing when focus is outside the active surface", () => {
		const log = vi.fn();
		mountSurface({ command: "kubectl get pods", facts: {}, log });
		const outside = document.createElement("input");
		document.body.append(outside);
		outside.focus();
		expect(runActionKey(ctrlF(), BOUND)).toBe(false);
		expect(log.mock.calls).toEqual([]);
	});
});
