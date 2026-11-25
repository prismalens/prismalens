// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	Item,
	type TranscriptRowNode,
	type TranscriptWindow,
	WindowedTranscript,
} from "./WindowedTranscript";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// virtua measures the item's content box, so any padding or margin on the item itself
// is left out of a row's height and the next row overlaps it (#1101 cat 12).
describe("the windowed transcript's row item", () => {
	let host: HTMLElement;
	let root: Root;
	beforeEach(() => {
		host = document.createElement("ol");
		document.body.append(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	it("keeps the row gap inside the measured item: the item has no padding or margin, its child carries pt-3", () => {
		act(() =>
			root.render(
				<Item style={{ position: "absolute", top: 40 }}>
					<p>row</p>
				</Item>,
			),
		);
		const item = host.querySelector('[data-testid="transcript-item"]');
		expect(item?.tagName).toBe("LI");
		expect(item?.getAttribute("class")).toBeNull();
		expect(item?.getAttribute("style")).toBe("position: absolute; top: 40px;");
		expect(item?.firstElementChild?.getAttribute("class")).toBe("px-4 pt-3");
		expect(item?.textContent).toBe("row");
	});
});

describe("WindowedTranscript trimmed head (#1181)", () => {
	let host: HTMLElement;
	let root: Root;
	const OrigResizeObserver = globalThis.ResizeObserver;

	beforeEach(() => {
		const MockRO = class MockResizeObserver {
			private cb: ResizeObserverCallback;
			constructor(cb: ResizeObserverCallback) {
				this.cb = cb;
			}
			observe(target: Element) {
				setTimeout(() => {
					this.cb(
						[
							{
								target,
								contentRect: {
									width: 800,
									height: 600,
									top: 0,
									left: 0,
									bottom: 600,
									right: 800,
									x: 0,
									y: 0,
									toJSON: () => {},
								},
							} as ResizeObserverEntry,
						],
						this,
					);
				}, 0);
			}
			unobserve() {}
			disconnect() {}
		};
		globalThis.ResizeObserver = MockRO;
		if (typeof window !== "undefined") {
			(window as unknown as { ResizeObserver?: unknown }).ResizeObserver =
				MockRO;
		}
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	});
	afterEach(() => {
		globalThis.ResizeObserver = OrigResizeObserver;
		act(() => root.unmount());
		host.remove();
	});

	it("with trimmed true, hasBefore true and short content, onBefore is not called by itself; N earlier button shows and its click calls onFollow(false) then onBefore, then to-end control shows and calls onFollow(true) and onToTail", async () => {
		const onBefore = vi.fn();
		const onFollow = vi.fn();
		const onToTail = vi.fn();

		const win: TranscriptWindow = {
			hasBefore: true,
			hasAfter: false,
			trimmed: true,
			edges: { before: "idle", after: "idle" },
			change: "replace",
			onBefore,
			onAfter: vi.fn(),
			folded: new Map(),
			onUnfold: vi.fn().mockResolvedValue(undefined),
			target: null,
			earlier: 25,
			messages: 10,
			onToTail,
			onFollow,
			connection: "idle",
			unsaved: 0,
			lost: 0,
		};

		const rows: TranscriptRowNode[] = [
			{ key: "row-1", at: "main:1", node: <div>Short content</div> },
		];

		await act(async () => {
			root.render(<WindowedTranscript rows={rows} win={win} live={true} />);
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		expect(onBefore).toHaveBeenCalledTimes(0);

		const earlierBtn = host.querySelector<HTMLButtonElement>(
			'[data-testid="transcript-earlier"]',
		);
		expect(earlierBtn).not.toBeNull();
		expect(earlierBtn?.textContent).toContain("25 earlier");

		await act(async () => {
			earlierBtn?.click();
			await new Promise((r) => setTimeout(r, 20));
		});
		expect(onFollow).toHaveBeenCalledWith(false);
		expect(onBefore).toHaveBeenCalledTimes(1);
		const followOrder = onFollow.mock.invocationCallOrder[0] ?? 0;
		const beforeOrder = onBefore.mock.invocationCallOrder[0] ?? 0;
		expect(followOrder).toBeLessThan(beforeOrder);

		const toEndBtn = host.querySelector<HTMLButtonElement>(
			'[data-testid="transcript-to-end"]',
		);
		expect(toEndBtn).not.toBeNull();

		await act(async () => {
			toEndBtn?.click();
			await new Promise((r) => setTimeout(r, 20));
		});
		expect(onFollow).toHaveBeenLastCalledWith(true);
		expect(onToTail).toHaveBeenCalledTimes(1);
	});

	it("with trimmed false and short content, onBefore is called by itself", () => {
		const onBefore = vi.fn();

		const win: TranscriptWindow = {
			hasBefore: true,
			hasAfter: false,
			trimmed: false,
			edges: { before: "idle", after: "idle" },
			change: "replace",
			onBefore,
			onAfter: vi.fn(),
			folded: new Map(),
			onUnfold: vi.fn().mockResolvedValue(undefined),
			target: null,
			messages: 10,
			onToTail: vi.fn(),
			connection: "idle",
			unsaved: 0,
			lost: 0,
		};

		const rows: TranscriptRowNode[] = [
			{ key: "row-1", at: "main:1", node: <div>Short content</div> },
		];

		act(() => {
			root.render(<WindowedTranscript rows={rows} win={win} live={true} />);
		});

		expect(onBefore).toHaveBeenCalledTimes(1);
	});
});
