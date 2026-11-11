// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelTab } from "./panel-model";
import { ThreadSidePanel } from "./ThreadSidePanel";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("ThreadSidePanel (#1024)", () => {
	it("renders a tablist with both tabs, aria-selected on the shown one, and click calls onTab with its id", async () => {
		const onTab = vi.fn();
		const tabs: PanelTab[] = [
			{ id: "thread", label: "Thread" },
			{ id: "changes", label: "Changes" },
		];
		await act(async () => {
			root.render(
				<ThreadSidePanel
					tabs={tabs}
					tab="thread"
					onTab={onTab}
					onClose={vi.fn()}
					content={<div>Thread content</div>}
				/>,
			);
		});
		const tablist = container.querySelector('[role="tablist"]');
		expect(tablist).not.toBeNull();
		const tabButtons = container.querySelectorAll('[role="tab"]');
		expect(tabButtons).toHaveLength(2);
		expect(tabButtons[0]?.getAttribute("aria-selected")).toBe("true");
		expect(tabButtons[1]?.getAttribute("aria-selected")).toBe("false");

		await act(async () => {
			(tabButtons[1] as HTMLButtonElement).click();
		});
		expect(onTab).toHaveBeenCalledWith("changes");
	});

	it("renders no role tablist and an h2 with that tab's label when given one tab", async () => {
		const tabs: PanelTab[] = [{ id: "thread", label: "Thread" }];
		await act(async () => {
			root.render(
				<ThreadSidePanel
					tabs={tabs}
					tab="thread"
					onTab={vi.fn()}
					onClose={vi.fn()}
					content={<div>Thread content</div>}
				/>,
			);
		});
		expect(container.querySelector('[role="tablist"]')).toBeNull();
		const h2 = container.querySelector("h2");
		expect(h2?.textContent).toBe("Thread");
	});

	it("calls onClose when Escape key is pressed", async () => {
		const onClose = vi.fn();
		const tabs: PanelTab[] = [
			{ id: "thread", label: "Thread" },
			{ id: "changes", label: "Changes" },
		];
		await act(async () => {
			root.render(
				<ThreadSidePanel
					tabs={tabs}
					tab="thread"
					onTab={vi.fn()}
					onClose={onClose}
					content={<div>Thread content</div>}
				/>,
			);
		});
		const panelEl = container.querySelector("#thread-panel");
		await act(async () => {
			panelEl?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("gives a tab with flagged 2 the aria-label Incident, 2 flagged items", async () => {
		const tabs: PanelTab[] = [
			{ id: "kind", label: "Incident", flagged: 2 },
			{ id: "thread", label: "Thread" },
		];
		await act(async () => {
			root.render(
				<ThreadSidePanel
					tabs={tabs}
					tab="kind"
					onTab={vi.fn()}
					onClose={vi.fn()}
					content={<div>Incident content</div>}
				/>,
			);
		});
		const kindTab = container.querySelector('[data-testid="panel-tab-kind"]');
		expect(kindTab?.getAttribute("aria-label")).toBe(
			"Incident, 2 flagged items",
		);
	});
});
