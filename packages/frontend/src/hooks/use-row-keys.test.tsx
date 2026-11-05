// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRowKeys } from "./use-row-keys";

function List({ current }: { current?: number }) {
	const ref = useRef<HTMLDivElement>(null);
	useRowKeys(ref, "a[data-row]");
	return (
		<div ref={ref}>
			{[0, 1, 2].map((i) => (
				<a
					key={i}
					href={`#${i}`}
					data-row
					data-i={i}
					aria-current={current === i ? "page" : undefined}
				>
					row {i}
				</a>
			))}
			<input data-testid="field" />
		</div>
	);
}

describe("useRowKeys (#1020)", () => {
	let host: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		for (const d of Array.from(document.querySelectorAll("[role=dialog]")))
			d.remove();
	});
	const press = (key: string, target: EventTarget = window) =>
		act(() => {
			target.dispatchEvent(
				new KeyboardEvent("keydown", { key, bubbles: true }),
			);
		});
	const focused = () =>
		(document.activeElement as HTMLElement | null)?.dataset.i;

	it("j starts at the current row and walks down; k walks up and stops at the top", () => {
		act(() => root.render(<List current={1} />));
		press("j");
		expect(focused()).toBe("1");
		press("j");
		press("j");
		expect(focused()).toBe("2");
		press("k");
		press("k");
		press("k");
		expect(focused()).toBe("0");
	});

	it("starts at the first row when none is current", () => {
		act(() => root.render(<List />));
		press("j");
		expect(focused()).toBe("0");
	});

	it("leaves the keys alone while typing or with a dialog open", () => {
		act(() => root.render(<List />));
		const field = host.querySelector<HTMLInputElement>("[data-testid=field]");
		field?.focus();
		press("j", field as HTMLInputElement);
		expect(document.activeElement).toBe(field);
		field?.blur();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.append(dialog);
		press("j");
		expect(focused()).toBeUndefined();
	});
});
