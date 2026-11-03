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

type Win = Window & { __plEarlyKeys?: string[] | null };
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
		expect(takeEarlyKeys()).toEqual(["c"]);
		expect(takeEarlyKeys()).toEqual([]);
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "c", bubbles: true }),
		);
		expect(win.__plEarlyKeys).toBeNull();
	});

	it("a `c` pressed before the shortcuts mounted opens New thread once they do", async () => {
		win.__plEarlyKeys = ["c"];
		await act(async () => root.render(createElement(Probe)));
		expect(onNew).toHaveBeenCalledTimes(1);
		expect(win.__plEarlyKeys).toBeNull();
	});

	it("an early `g` then `a` still moves to Alerts", async () => {
		win.__plEarlyKeys = ["g", "a"];
		await act(async () => root.render(createElement(Probe)));
		expect(navigate).toHaveBeenCalledWith({ to: "/alerts" });
	});

	it("keys pressed after mounting are handled once, not replayed", async () => {
		await act(async () => root.render(createElement(Probe)));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
		expect(onNew).toHaveBeenCalledTimes(1);
	});
});
