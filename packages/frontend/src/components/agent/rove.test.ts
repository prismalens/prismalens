// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { focusChosen, roveKeys } from "./rove";

function menu() {
	document.body.innerHTML = `<div id="m">
		<button data-rove id="a">A</button>
		<button data-rove id="b" data-chosen>B</button>
		<button data-rove id="c" disabled>C</button>
		<button data-rove id="d">D</button>
	</div>`;
	return document.getElementById("m") as HTMLElement;
}
const press = (root: HTMLElement, key: string) => {
	let prevented = false;
	roveKeys({
		key,
		currentTarget: root,
		preventDefault: () => {
			prevented = true;
		},
	} as unknown as KeyboardEvent<HTMLElement>);
	return prevented;
};

describe("roveKeys (#811)", () => {
	it("moves down and up, skips disabled rows, wraps, and jumps with Home and End", () => {
		const root = menu();
		focusChosen({ currentTarget: root, preventDefault: () => {} } as unknown as Event);
		expect(document.activeElement?.id).toBe("b");
		press(root, "ArrowDown");
		expect(document.activeElement?.id).toBe("d");
		press(root, "ArrowDown");
		expect(document.activeElement?.id).toBe("a");
		press(root, "ArrowUp");
		expect(document.activeElement?.id).toBe("d");
		press(root, "Home");
		expect(document.activeElement?.id).toBe("a");
		press(root, "End");
		expect(document.activeElement?.id).toBe("d");
	});

	it("makes the focused row the only tab stop", () => {
		const root = menu();
		const tab = (id: string) => (document.getElementById(id) as HTMLElement).tabIndex;
		focusChosen({ currentTarget: root, preventDefault: () => {} } as unknown as Event);
		press(root, "ArrowUp");
		expect(document.activeElement?.id).toBe("a");
		expect([tab("a"), tab("b"), tab("d")]).toEqual([0, -1, -1]);
	});

	it("leaves other keys alone", () => {
		expect(press(menu(), "Enter")).toBe(false);
	});
});
