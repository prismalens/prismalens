// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, type ReactNode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusLater } from "@/components/run/HypothesesCard";
import { BottomPanel, PanelShell, RightPanel } from "./PanelShell";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let width = 1440;
const listeners = new Set<() => void>();
function resize(w: number) {
	width = w;
	act(() => {
		for (const l of Array.from(listeners)) l();
	});
}
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
		addEventListener: (_: string, l: () => void) => listeners.add(l),
		removeEventListener: (_: string, l: () => void) => listeners.delete(l),
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

	it("makes the panel a full-screen modal sheet on a phone", () => {
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
		expect(sheet?.contains(q("#details"))).toBe(true);
		expect(
			q("[data-testid=shell-frame]")?.closest("[aria-hidden=true]"),
		).not.toBeNull();
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
		expect(q("[data-testid=panel-bottom]")).toBeNull();
		expect(q("#term")?.closest("[hidden][inert]")).toBeTruthy();
	});
});

describe("PanelShell under adversary review (#974)", () => {
	it("renders when storage throws on access", () => {
		const real = Object.getOwnPropertyDescriptor(window, "localStorage");
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			get() {
				throw new DOMException("denied", "SecurityError");
			},
		});
		try {
			render(
				<RightPanel open label="Run details" onClose={noop}>
					<p id="details">details</p>
				</RightPanel>,
			);
			expect(q("#details")).not.toBeNull();
		} finally {
			if (real) Object.defineProperty(window, "localStorage", real);
		}
	});

	it("keeps the panel's content mounted across breakpoints", () => {
		let mounts = 0;
		function Counter() {
			const [n, setN] = useState(() => {
				mounts++;
				return 0;
			});
			return (
				<button type="button" id="count" onClick={() => setN(n + 1)}>
					{n}
				</button>
			);
		}
		render(
			<RightPanel open label="Run details" onClose={noop}>
				<Counter />
			</RightPanel>,
		);
		act(() => q("#count")?.click());
		resize(900);
		resize(390);
		resize(1440);
		expect(q("#count")?.textContent).toBe("1");
		expect(mounts).toBe(1);
	});

	it("closes on Escape pressed inside the panel's content", () => {
		width = 900;
		const onClose = vi.fn();
		render(
			<RightPanel open label="Run details" onClose={onClose}>
				<button type="button" id="inside">
					inside
				</button>
			</RightPanel>,
		);
		act(() => {
			q("#inside")?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("hides everything outside a phone's sheet while it shows, and gives it back on close", () => {
		width = 390;
		const outside = document.createElement("nav");
		document.body.prepend(outside);
		render(
			<RightPanel open label="Run details" onClose={noop}>
				<p id="details">details</p>
			</RightPanel>,
		);
		expect(outside.getAttribute("aria-hidden")).toBe("true");
		render(
			<RightPanel open={false} label="Run details" onClose={noop}>
				<p id="details">details</p>
			</RightPanel>,
		);
		expect(outside.hasAttribute("aria-hidden")).toBe(false);
	});

	it("keeps a bottom panel's content mounted and inert while closed (OBJ-004)", () => {
		function Term() {
			const [n, setN] = useState(0);
			return (
				<button type="button" id="term" onClick={() => setN(n + 1)}>
					{n}
				</button>
			);
		}
		const page = (open: boolean) => (
			<BottomPanel open={open} label="Terminal">
				<Term />
			</BottomPanel>
		);
		render(page(true));
		act(() => q("#term")?.click());
		render(page(false));
		expect(q("[data-testid=panel-bottom]")).toBeNull();
		expect(q("#term")?.closest("[inert]")).toBeTruthy();
		expect(q("#term")?.closest("[hidden]")).toBeTruthy();
		render(page(true));
		expect(q("[data-testid=panel-bottom]")?.contains(q("#term"))).toBe(true);
		expect(q("#term")?.closest("[inert]")).toBeNull();
		expect(q("#term")?.textContent).toBe("1");
	});

	it.each([
		["inside the sheet", true],
		["under the sheet", false],
	])(
		"on a phone, Back from a file returns focus to an opener %s (#1005)",
		(_, inside) => {
			vi.useFakeTimers();
			width = 390;
			function Page() {
				const [panel, setPanel] = useState(inside);
				const [file, setFile] = useState(false);
				const from = useRef<{ inPanel: boolean } | null>(null);
				const focusLater = useFocusLater();
				const open = () => {
					from.current = {
						inPanel: !!q("[data-testid=panel-right]")?.contains(q("#opener")),
					};
					setFile(true);
					setPanel(true);
					focusLater("back");
				};
				const back = () => {
					setFile(false);
					if (!from.current?.inPanel) setPanel(false);
					focusLater("opener");
				};
				const opener = (
					<button type="button" id="opener" onClick={open}>
						open
					</button>
				);
				return (
					<>
						{!inside && opener}
						<RightPanel open={panel} label="Run details" onClose={noop}>
							{file ? (
								<button type="button" id="back" onClick={back}>
									Back
								</button>
							) : (
								inside && opener
							)}
						</RightPanel>
					</>
				);
			}
			try {
				render(<Page />);
				act(() => q("#opener")?.click());
				act(() => vi.runAllTimers());
				expect(document.activeElement?.id).toBe("back");
				act(() => q("#back")?.click());
				act(() => vi.runAllTimers());
				expect(document.activeElement?.id).toBe("opener");
				expect(q("[data-testid=panel-right]") !== null).toBe(inside);
			} finally {
				vi.useRealTimers();
			}
		},
	);

	it("keeps focus on the control it was on when the panel moves between regions", () => {
		render(
			<RightPanel open label="Run details" onClose={noop}>
				<button type="button" id="inside">
					inside
				</button>
			</RightPanel>,
		);
		act(() => q("#inside")?.focus());
		resize(900);
		expect(document.activeElement?.id).toBe("inside");
	});
});
