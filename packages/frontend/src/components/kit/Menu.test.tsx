// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ContextMenu,
	commandEntries,
	Menu,
	type MenuEntry,
	orderEntries,
} from "./Menu";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
globalThis.DOMRect ??= class DOMRect {
	bottom = 0;
	left = 0;
	right = 0;
	top = 0;
	width = 0;
	height = 0;
	x = 0;
	y = 0;
	toJSON() {
		return JSON.stringify(this);
	}
	static fromRect() {
		return new DOMRect();
	}
} as unknown as typeof DOMRect;
if (!Element.prototype.getBoundingClientRect) {
	Element.prototype.getBoundingClientRect = () => new DOMRect();
}

/** In happy-dom / jsdom, Radix DropdownMenu trigger listens to pointerdown (button 0, ctrlKey false). */
function openDropdownMenu(trigger: HTMLElement) {
	trigger.dispatchEvent(
		new PointerEvent("pointerdown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			ctrlKey: false,
		}),
	);
}

describe("Menu and ContextMenu", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("orderEntries: a danger entry listed first ends last, behind exactly one separator with id sep-danger; leading, trailing and doubled separators are dropped", () => {
		const entries: MenuEntry[] = [
			{ id: "sep-lead-1", separator: true },
			{ id: "sep-lead-2", separator: true },
			{ id: "delete", label: "Delete", danger: true, onSelect: () => {} },
			{ id: "sep-mid-1", separator: true },
			{ id: "sep-mid-2", separator: true },
			{ id: "copy", label: "Copy", onSelect: () => {} },
			{ id: "sep-mid-3", separator: true },
			{ id: "edit", label: "Edit", onSelect: () => {} },
			{ id: "sep-trail-1", separator: true },
			{ id: "sep-trail-2", separator: true },
		];

		const ordered = orderEntries(entries);
		const ids = ordered.map((e) => e.id);

		expect(ids).toEqual(["copy", "sep-mid-3", "edit", "sep-danger", "delete"]);
	});

	it("commandEntries returns the ordered entries without separators", () => {
		const entries: MenuEntry[] = [
			{ id: "sep-lead", separator: true },
			{ id: "delete", label: "Delete", danger: true, onSelect: () => {} },
			{ id: "sep-1", separator: true },
			{ id: "copy", label: "Copy", onSelect: () => {} },
			{ id: "sep-2", separator: true },
			{ id: "edit", label: "Edit", onSelect: () => {} },
			{ id: "sep-trail", separator: true },
		];

		const cmds = commandEntries(entries);
		const ids = cmds.map((e) => e.id);

		expect(ids).toEqual(["copy", "edit", "delete"]);
	});

	it("ContextMenu: pressing Shift+F10 on a focused button inside the trigger opens the menu (role=menu with aria-label equal to the label prop) and lists the entries in order (exact data-testid list menu-<id>)", async () => {
		const entries: MenuEntry[] = [
			{ id: "edit", label: "Edit", onSelect: () => {} },
			{ id: "copy", label: "Copy", onSelect: () => {} },
			{ id: "delete", label: "Delete", danger: true, onSelect: () => {} },
		];

		await act(async () => {
			root.render(
				<ContextMenu entries={entries} label="Item actions">
					<button type="button" data-testid="target-btn">
						Target
					</button>
				</ContextMenu>,
			);
		});

		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="target-btn"]',
		);
		expect(btn).not.toBeNull();
		btn?.focus();

		await act(async () => {
			btn?.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "F10",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		const menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();
		expect(menu?.getAttribute("aria-label")).toBe("Item actions");

		const renderedIds = Array.from(
			document.querySelectorAll<HTMLElement>('[data-testid^="menu-"]'),
		)
			.map((el) => el.getAttribute("data-testid"))
			.filter((id): id is string => id !== null && !id.endsWith("-keys"));

		expect(renderedIds).toEqual(["menu-edit", "menu-copy", "menu-delete"]);
	});

	it("ContextMenu: pressing ContextMenu key on a focused button inside the trigger opens the menu and lists the entries in order", async () => {
		const entries: MenuEntry[] = [
			{ id: "first", label: "First", onSelect: () => {} },
			{ id: "second", label: "Second", onSelect: () => {} },
			{ id: "remove", label: "Remove", danger: true, onSelect: () => {} },
		];

		await act(async () => {
			root.render(
				<ContextMenu entries={entries} label="Context key actions">
					<button type="button" data-testid="context-key-btn">
						Target
					</button>
				</ContextMenu>,
			);
		});

		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="context-key-btn"]',
		);
		expect(btn).not.toBeNull();
		btn?.focus();

		await act(async () => {
			btn?.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ContextMenu",
					shiftKey: false,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		const menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();
		expect(menu?.getAttribute("aria-label")).toBe("Context key actions");

		const renderedIds = Array.from(
			document.querySelectorAll<HTMLElement>('[data-testid^="menu-"]'),
		)
			.map((el) => el.getAttribute("data-testid"))
			.filter((id): id is string => id !== null && !id.endsWith("-keys"));

		expect(renderedIds).toEqual(["menu-first", "menu-second", "menu-remove"]);
	});

	it("Menu and ContextMenu given the same entries render the same menu-<id> test ids in the same order", async () => {
		const entries: MenuEntry[] = [
			{ id: "cut", label: "Cut", onSelect: () => {} },
			{ id: "copy", label: "Copy", onSelect: () => {} },
			{ id: "destroy", label: "Destroy", danger: true, onSelect: () => {} },
		];

		// 1. Render Menu (the ⋯ dropdown menu) and open it
		await act(async () => {
			root.render(
				<Menu
					trigger={
						<button type="button" data-testid="menu-trigger">
							Open Menu
						</button>
					}
					entries={entries}
					label="Actions"
				/>,
			);
		});

		const menuTrigger = container.querySelector<HTMLButtonElement>(
			'[data-testid="menu-trigger"]',
		);
		expect(menuTrigger).not.toBeNull();

		await act(async () => {
			if (menuTrigger) openDropdownMenu(menuTrigger);
		});

		const menuItems = Array.from(
			document.querySelectorAll<HTMLElement>(
				'[role="menu"] [data-testid^="menu-"]',
			),
		)
			.map((el) => el.getAttribute("data-testid"))
			.filter((id): id is string => id !== null && !id.endsWith("-keys"));

		// Clean up Menu
		await act(async () => root.unmount());
		document.body.innerHTML = "";
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);

		// 2. Render ContextMenu and open it
		await act(async () => {
			root.render(
				<ContextMenu entries={entries} label="Actions">
					<button type="button" data-testid="context-trigger">
						Target
					</button>
				</ContextMenu>,
			);
		});

		const contextTrigger = container.querySelector<HTMLButtonElement>(
			'[data-testid="context-trigger"]',
		);
		expect(contextTrigger).not.toBeNull();
		contextTrigger?.focus();

		await act(async () => {
			contextTrigger?.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "F10",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		const contextItems = Array.from(
			document.querySelectorAll<HTMLElement>(
				'[role="menu"] [data-testid^="menu-"]',
			),
		)
			.map((el) => el.getAttribute("data-testid"))
			.filter((id): id is string => id !== null && !id.endsWith("-keys"));

		expect(menuItems).toEqual(["menu-cut", "menu-copy", "menu-destroy"]);
		expect(contextItems).toEqual(["menu-cut", "menu-copy", "menu-destroy"]);
		expect(menuItems).toEqual(contextItems);
	});

	it("A danger entry has data-danger and is the last item in both menus", async () => {
		const entries: MenuEntry[] = [
			{
				id: "danger-first",
				label: "Delete First",
				danger: true,
				onSelect: () => {},
			},
			{ id: "normal-a", label: "Normal A", onSelect: () => {} },
			{ id: "normal-b", label: "Normal B", onSelect: () => {} },
		];

		// Check in Menu
		await act(async () => {
			root.render(
				<Menu
					trigger={
						<button type="button" data-testid="menu-trig">
							Trigger
						</button>
					}
					entries={entries}
					label="Menu Test"
				/>,
			);
		});

		const menuTrig = container.querySelector<HTMLButtonElement>(
			'[data-testid="menu-trig"]',
		);
		expect(menuTrig).not.toBeNull();

		await act(async () => {
			if (menuTrig) openDropdownMenu(menuTrig);
		});

		const menuEls = Array.from(
			document.querySelectorAll<HTMLElement>(
				'[role="menu"] [data-testid^="menu-"]',
			),
		).filter((el) => !el.getAttribute("data-testid")?.endsWith("-keys"));

		const lastMenuItem = menuEls.at(-1);
		expect(lastMenuItem?.getAttribute("data-testid")).toBe("menu-danger-first");
		expect(lastMenuItem?.getAttribute("data-danger")).toBe("true");

		// Clean up
		await act(async () => root.unmount());
		document.body.innerHTML = "";
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);

		// Check in ContextMenu
		await act(async () => {
			root.render(
				<ContextMenu entries={entries} label="Context Test">
					<button type="button" data-testid="cm-trig">
						Trigger
					</button>
				</ContextMenu>,
			);
		});

		const cmBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="cm-trig"]',
		);
		expect(cmBtn).not.toBeNull();
		cmBtn?.focus();

		await act(async () => {
			cmBtn?.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ContextMenu",
					shiftKey: false,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		const contextEls = Array.from(
			document.querySelectorAll<HTMLElement>(
				'[role="menu"] [data-testid^="menu-"]',
			),
		).filter((el) => !el.getAttribute("data-testid")?.endsWith("-keys"));

		const lastContextItem = contextEls.at(-1);
		expect(lastContextItem?.getAttribute("data-testid")).toBe(
			"menu-danger-first",
		);
		expect(lastContextItem?.getAttribute("data-danger")).toBe("true");
	});

	it("An entry with keys: Mod+F shows Ctrl+F in menu-<id>-keys (navigator.platform not Mac in jsdom) and has aria-keyshortcuts=Control+F", async () => {
		vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");

		const entries: MenuEntry[] = [
			{ id: "find", label: "Find", keys: "Mod+F", onSelect: () => {} },
		];

		await act(async () => {
			root.render(
				<Menu
					trigger={
						<button type="button" data-testid="mod-trig">
							Open
						</button>
					}
					entries={entries}
					label="Shortcuts"
				/>,
			);
		});

		const trig = container.querySelector<HTMLButtonElement>(
			'[data-testid="mod-trig"]',
		);
		expect(trig).not.toBeNull();

		await act(async () => {
			if (trig) openDropdownMenu(trig);
		});

		const findItem = document.querySelector<HTMLElement>(
			'[data-testid="menu-find"]',
		);
		expect(findItem).not.toBeNull();
		expect(findItem?.getAttribute("aria-keyshortcuts")).toBe("Control+F");

		const keysKbd = document.querySelector<HTMLElement>(
			'[data-testid="menu-find-keys"]',
		);
		expect(keysKbd).not.toBeNull();
		expect(keysKbd?.textContent).toBe("Ctrl+F");
	});

	it("Selecting an entry calls its onSelect once", async () => {
		const onSelectSpy = vi.fn();
		const entries: MenuEntry[] = [
			{ id: "item-click", label: "Clickable Item", onSelect: onSelectSpy },
		];

		await act(async () => {
			root.render(
				<Menu
					trigger={
						<button type="button" data-testid="select-trig">
							Open
						</button>
					}
					entries={entries}
					label="Select Test"
				/>,
			);
		});

		const trig = container.querySelector<HTMLButtonElement>(
			'[data-testid="select-trig"]',
		);
		expect(trig).not.toBeNull();

		await act(async () => {
			if (trig) openDropdownMenu(trig);
		});

		const item = document.querySelector<HTMLElement>(
			'[data-testid="menu-item-click"]',
		);
		expect(item).not.toBeNull();

		await act(async () => {
			item?.click();
		});

		expect(onSelectSpy).toHaveBeenCalledTimes(1);
	});
});
