// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Item } from "./WindowedTranscript";

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
