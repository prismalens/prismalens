// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EARLY_KEYS_SCRIPT, takeEarlyKeys } from "@/lib/early-keys";
import { useGlobalShortcuts } from "./use-global-shortcuts";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

type Early = { k: string; t: number; p: string };
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
	it("the pre-paint script keeps keys, but not ones typed into a field or with a modifier", () => {
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
		expect(takeEarlyKeys().map((e) => e.k)).toEqual(["c"]);
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

	it("an early `g` then `a` still moves to Alerts", async () => {
		win.__plEarlyKeys = [early("g", 200), early("a", 100)];
		await act(async () => root.render(createElement(Probe)));
		expect(navigate).toHaveBeenCalledWith({ to: "/alerts" });
	});

	it("a chord finished before mount counts by its own gap: g 1.5 s and a 1.2 s ago move to Alerts", async () => {
		win.__plEarlyKeys = [early("g", 1_500), early("a", 1_200)];
		await act(async () => root.render(createElement(Probe)));
		expect(navigate).toHaveBeenCalledWith({ to: "/alerts" });
	});

	it("drops a stale key: g then a ten seconds apart moves nowhere", async () => {
		win.__plEarlyKeys = [early("g", 10_100), early("a", 100)];
		await act(async () => root.render(createElement(Probe)));
		expect(navigate).not.toHaveBeenCalled();
	});

	it("an early g and a further apart than the chord window move nowhere", async () => {
		win.__plEarlyKeys = [early("g", 1_900), early("a", 100)];
		await act(async () => root.render(createElement(Probe)));
		expect(navigate).not.toHaveBeenCalled();
	});

	it("a g buffered 1.5 s ago arms no chord: a live a then moves nowhere", async () => {
		win.__plEarlyKeys = [early("g", 1_500)];
		await act(async () => root.render(createElement(Probe)));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
		expect(navigate).not.toHaveBeenCalled();
	});

	it("a g buffered 300 ms ago keeps only what is left of its window", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			win.__plEarlyKeys = [early("g", 300)];
			await act(async () => root.render(createElement(Probe)));
			vi.advanceTimersByTime(800);
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
			expect(navigate).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
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

	it("keys pressed after mounting are handled once, not replayed", async () => {
		await act(async () => root.render(createElement(Probe)));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
		expect(onNew).toHaveBeenCalledTimes(1);
	});
});
