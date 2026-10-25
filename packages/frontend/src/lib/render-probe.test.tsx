// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, memo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderReason, useRenderProbe } from "./render-probe";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("renderReason", () => {
	it("returns mount when prev is null", () => {
		expect(renderReason(null, { a: 1 })).toBe("mount");
	});

	it("returns single changed key", () => {
		expect(renderReason({ a: 1 }, { a: 2 })).toBe("a");
	});

	it("returns comma-joined keys when multiple change", () => {
		expect(renderReason({ a: 1, b: 2 }, { a: 10, b: 20 })).toBe("a,b");
	});

	it("returns parent or state when values match by Object.is", () => {
		expect(renderReason({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(
			"parent or state",
		);
	});

	it("treats NaN to NaN as unchanged", () => {
		expect(renderReason({ a: Number.NaN }, { a: Number.NaN })).toBe(
			"parent or state",
		);
	});
});

describe("useRenderProbe", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		window.__renderProbe?.reset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("tracks mount, prop changes, parent re-renders, counts, and reset", () => {
		function Box({ value, count: _count }: { value: string; count: number }) {
			useRenderProbe("Box", { value });
			return <div>{value}</div>;
		}

		let setParentState: React.Dispatch<
			React.SetStateAction<{ value: string; count: number }>
		> = () => {};

		function Parent() {
			const [state, setState] = useState({ value: "initial", count: 0 });
			setParentState = setState;
			return <Box value={state.value} count={state.count} />;
		}

		act(() => {
			root.render(<Parent />);
		});

		expect(window.__renderProbe?.log).toHaveLength(1);
		expect(window.__renderProbe?.log[0]).toMatchObject({
			name: "Box",
			reason: "mount",
		});

		act(() => {
			setParentState({ value: "updated", count: 0 });
		});

		expect(window.__renderProbe?.log).toHaveLength(2);
		expect(window.__renderProbe?.log[1]).toMatchObject({
			name: "Box",
			reason: "value",
		});

		act(() => {
			setParentState({ value: "updated", count: 1 });
		});

		expect(window.__renderProbe?.log).toHaveLength(3);
		expect(window.__renderProbe?.log[2]).toMatchObject({
			name: "Box",
			reason: "parent or state",
		});
		expect(window.__renderProbe?.counts()).toEqual({ Box: 3 });

		window.__renderProbe?.reset();
		expect(window.__renderProbe?.log).toEqual([]);
		expect(window.__renderProbe?.counts()).toEqual({});
	});

	it("logs nothing when a memoized child receives unchanged props on parent re-render", () => {
		const MemoChild = memo(function MemoChild({ label }: { label: string }) {
			useRenderProbe("MemoChild", { label });
			return <span>{label}</span>;
		});

		let triggerParentRender: () => void = () => {};

		function Parent() {
			const [, setCount] = useState(0);
			triggerParentRender = () => setCount((c) => c + 1);
			return <MemoChild label="static" />;
		}

		act(() => {
			root.render(<Parent />);
		});

		expect(window.__renderProbe?.counts()).toEqual({ MemoChild: 1 });

		act(() => {
			triggerParentRender();
		});

		expect(window.__renderProbe?.counts()).toEqual({ MemoChild: 1 });
		expect(window.__renderProbe?.log).toHaveLength(1);
	});
});
