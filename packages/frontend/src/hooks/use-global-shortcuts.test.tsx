// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppCommand } from "@/lib/app-commands";
import { EARLY_KEYS_SCRIPT, takeEarlyKeys } from "@/lib/early-keys";
import { useAppKeys, useGlobalShortcuts } from "./app-keys";
import { listenKeys } from "./use-global-shortcuts";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

type Early = { k: string; t: number; p: string; a?: boolean };
type Win = Window & { __plEarlyKeys?: Early[] | null };
const early = (k: string, agoMs = 0, p = location.pathname): Early => ({
	k,
	t: Date.now() - agoMs,
	p,
});
const win = window as Win;

let container: HTMLDivElement;
let root: Root;
const onHelp = vi.fn();
const onNew = vi.fn();

function Probe() {
	useGlobalShortcuts(onHelp, onNew);
	return null;
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	onHelp.mockReset();
	onNew.mockReset();
	navigate.mockReset();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	win.__plEarlyKeys = undefined;
});

describe("keys pressed before the app is ready (#1020)", () => {
	// A modified key is kept with its modifiers since the key listeners mount after first content.
	it("the pre-paint script keeps keys and Ctrl K with its modifier, but not keys typed into a field", () => {
		new Function(EARLY_KEYS_SCRIPT)();
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "c", bubbles: true }),
		);
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
		);
		const field = document.createElement("input");
		document.body.appendChild(field);
		field.dispatchEvent(
			new KeyboardEvent("keydown", { key: "x", bubbles: true }),
		);
		field.remove();
		expect(takeEarlyKeys().map((e) => [e.k, !!e.c])).toEqual([
			["c", false],
			["k", true],
		]);
		expect(takeEarlyKeys()).toEqual([]);
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "c", bubbles: true }),
		);
		expect(win.__plEarlyKeys).toBeNull();
	});

	it("a `c` pressed before the shortcuts mounted opens New thread once they do", async () => {
		win.__plEarlyKeys = [early("c")];
		await act(async () => root.render(createElement(Probe)));
		expect(onNew).toHaveBeenCalledTimes(1);
		expect(win.__plEarlyKeys).toBeNull();
	});

	it("an early Alt+A moves to Alerts once the shortcuts mount", async () => {
		win.__plEarlyKeys = [{ ...early("a", 100), a: true }];
		await act(async () => root.render(createElement(Probe)));
		expect(navigate).toHaveBeenCalledWith({ to: "/alerts" });
	});

	// Letters always type (#1101): the old `g` chords are gone.
	it("an early g then a moves nowhere", async () => {
		win.__plEarlyKeys = [early("g", 200), early("a", 100)];
		await act(async () => root.render(createElement(Probe)));
		expect(navigate).not.toHaveBeenCalled();
	});

	it("drops keys pressed on another page", async () => {
		win.__plEarlyKeys = [early("c", 100, "/elsewhere")];
		await act(async () => root.render(createElement(Probe)));
		expect(onNew).not.toHaveBeenCalled();
	});

	it("drops keys when a field has focus or a dialog is open at replay", async () => {
		const field = document.createElement("input");
		document.body.appendChild(field);
		field.focus();
		win.__plEarlyKeys = [early("c")];
		await act(async () => root.render(createElement(Probe)));
		expect(onNew).not.toHaveBeenCalled();
		field.remove();
		await act(async () => root.unmount());
		root = createRoot(container);

		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.appendChild(dialog);
		win.__plEarlyKeys = [early("?")];
		await act(async () => root.render(createElement(Probe)));
		expect(onHelp).not.toHaveBeenCalled();
		dialog.remove();
	});

	const openList = () => {
		const list = document.createElement("div");
		list.setAttribute("role", "listbox");
		const option = document.createElement("div");
		option.setAttribute("role", "option");
		list.append(option);
		document.body.append(list);
		return { option, close: () => list.remove() };
	};
	const press = (target: Element, key: string) =>
		target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

	it("a letter typed into an open list before the shortcuts mounted stays the list's, never New incident (#1154)", async () => {
		new Function(EARLY_KEYS_SCRIPT)();
		const list = openList();
		press(list.option, "c");
		list.close();
		await act(async () => root.render(createElement(Probe)));
		expect(onNew).not.toHaveBeenCalled();
	});

	it("a letter typed outside a list is dropped at replay when a list is open by then (#1154)", async () => {
		new Function(EARLY_KEYS_SCRIPT)();
		press(document.body, "c");
		const list = openList();
		await act(async () => root.render(createElement(Probe)));
		list.close();
		expect(onNew).not.toHaveBeenCalled();
	});

	it("keys pressed after mounting are handled once, not replayed", async () => {
		await act(async () => root.render(createElement(Probe)));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
		expect(onNew).toHaveBeenCalledTimes(1);
	});

	it("leaves a letter typed in an open list to its typeahead", async () => {
		await act(async () => root.render(createElement(Probe)));
		const list = document.createElement("div");
		list.setAttribute("role", "listbox");
		const option = document.createElement("div");
		option.setAttribute("role", "option");
		list.append(option);
		document.body.append(list);
		option.dispatchEvent(
			new KeyboardEvent("keydown", { key: "c", bubbles: true }),
		);
		list.remove();
		expect(onNew).not.toHaveBeenCalled();
	});
});

describe("the shortcut runner's one key listener (L6)", () => {
	it("calls a target's handlers in subscription order, and stops calling one once it unsubscribes", () => {
		const seen: string[] = [];
		const offA = listenKeys(() => seen.push("a"));
		const offB = listenKeys(() => seen.push("b"));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
		offA();
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
		offB();
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
		expect(seen).toEqual(["a", "b", "b"]);
	});

	it("keeps an element's handlers to keys aimed at that element", () => {
		const el = document.createElement("div");
		document.body.append(el);
		const seen: string[] = [];
		const off = listenKeys((e) => seen.push(e.key), { target: el });
		el.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		off();
		el.remove();
		expect(seen).toEqual(["Escape"]);
	});

	it("runs an app key's command, but not a plain one while typing", async () => {
		const fold = vi.fn();
		function Keys() {
			useAppKeys();
			useAppCommand("foldSidebar", fold);
			return null;
		}
		await act(async () => root.render(createElement(Keys)));
		const input = document.createElement("input");
		document.body.append(input);
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "[", bubbles: true }),
		);
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
		input.remove();
		expect(fold).toHaveBeenCalledTimes(1);
	});
});
