// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TabPanel, Tabs } from "./Tabs";

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
});

const items = [
	{ value: "all", label: "All", testId: "tab-all" },
	{ value: "threads", label: "Threads", testId: "tab-threads" },
];
const tab = (id: string) =>
	container.querySelector(`[data-testid="${id}"]`) as HTMLElement;

describe("the kit tabs (sheet §0.2)", () => {
	it("gives a one-word tab at least the 24 px target width", async () => {
		await act(async () =>
			root.render(
				<Tabs
					label="Kinds"
					items={items}
					value="all"
					onValueChange={() => {}}
				/>,
			),
		);
		expect(tab("tab-all").className).toContain("min-w-6");
	});

	it("points a filter row's tabs at no panel, since it has none", async () => {
		await act(async () =>
			root.render(
				<Tabs
					label="Kinds"
					items={items}
					value="all"
					onValueChange={() => {}}
				/>,
			),
		);
		expect(tab("tab-all").hasAttribute("aria-controls")).toBe(false);
	});

	it("points each tab at its own panel when panels are given", async () => {
		await act(async () =>
			root.render(
				<Tabs label="Kinds" items={items} value="all" onValueChange={() => {}}>
					<TabPanel value="all">Everything</TabPanel>
					<TabPanel value="threads">Threads only</TabPanel>
				</Tabs>,
			),
		);
		const id = tab("tab-all").getAttribute("aria-controls");
		expect(id).toMatch(/-content-all$/);
		expect(document.getElementById(id ?? "")?.textContent).toBe("Everything");
	});
});
