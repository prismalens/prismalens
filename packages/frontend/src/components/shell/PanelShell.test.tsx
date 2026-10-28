// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomPanel, PanelShell, RightPanel } from "./PanelShell";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let width = 1440;
function matches(query: string): boolean {
	const min = /min-width:\s*(\d+)px/.exec(query);
	const max = /max-width:\s*(\d+)px/.exec(query);
	return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	width = 1440;
	window.matchMedia = ((query: string) => ({
		matches: matches(query),
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	})) as unknown as typeof window.matchMedia;
	window.localStorage.clear();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function render(node: ReactNode) {
	act(() => root.render(<PanelShell>{node}</PanelShell>));
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const noop = () => {};

describe("PanelShell", () => {
	it("shows the route alone when no page contributes a panel", () => {
		render(<p id="route">route</p>);
		expect(q("#route")).not.toBeNull();
		expect(q("[data-testid=panel-right]")).toBeNull();
		expect(q("[data-testid=panel-bottom]")).toBeNull();
		expect(q("[role=separator]")).toBeNull();
	});

	it("puts an open right panel beside the route with a keyboard separator", () => {
		render(
			<RightPanel open label="Run details" onClose={noop}>
				<p id="details">details</p>
			</RightPanel>,
		);
		expect(q("[data-testid=panel-right]")?.contains(q("#details"))).toBe(true);
		const sep = q("[data-testid=panel-right-separator]");
		expect(sep?.getAttribute("role")).toBe("separator");
		expect(sep?.tabIndex).toBe(0);
		expect(sep?.hasAttribute("aria-valuenow")).toBe(true);
	});

	it("renders nothing for a closed right panel", () => {
		render(
			<RightPanel open={false} label="Run details" onClose={noop}>
				<p id="details">details</p>
			</RightPanel>,
		);
		expect(q("#details")).toBeNull();
		expect(q("[data-testid=panel-right]")).toBeNull();
	});

	it("floats the panel over the route between 768 and 1023 px, and Escape closes it", () => {
		width = 900;
		const onClose = vi.fn();
		render(
			<RightPanel open label="Run details" onClose={onClose}>
				<p id="inside">inside</p>
			</RightPanel>,
		);
		const panel = q("[data-testid=panel-right]");
		expect(panel?.getAttribute("role")).toBe("dialog");
		expect(panel?.getAttribute("aria-modal")).toBe("false");
		expect(panel?.getAttribute("aria-label")).toBe("Run details");
		expect(document.activeElement).toBe(panel);
		expect(q("[role=separator]")).toBeNull();
		act(() => {
			panel?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("makes the panel a full-screen sheet on a phone, with the page behind it inert", () => {
		width = 390;
		render(
			<>
				<p id="route">route</p>
				<RightPanel open label="Run details" onClose={noop}>
					<p id="details">details</p>
				</RightPanel>
			</>,
		);
		const sheet = q("[data-testid=panel-right]");
		expect(sheet?.getAttribute("role")).toBe("dialog");
		expect(sheet?.getAttribute("aria-modal")).toBe("true");
		expect(sheet?.parentElement).toBe(document.body);
		expect(sheet?.contains(q("#details"))).toBe(true);
		expect(q("[data-testid=shell-route]")?.hasAttribute("inert")).toBe(true);
	});

	it("mounts a bottom panel under the route for the terminal", () => {
		render(
			<BottomPanel open label="Terminal">
				<p id="term">term</p>
			</BottomPanel>,
		);
		expect(q("[data-testid=panel-bottom]")?.contains(q("#term"))).toBe(true);
		expect(
			q("[data-testid=panel-bottom-separator]")?.getAttribute("role"),
		).toBe("separator");
	});

	it("gives a phone no bottom panel", () => {
		width = 390;
		render(
			<BottomPanel open label="Terminal">
				<p id="term">term</p>
			</BottomPanel>,
		);
		expect(q("#term")).toBeNull();
	});
});
