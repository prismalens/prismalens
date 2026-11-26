// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, Fragment, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { toast, useToast } from "./use-toast";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useToast", () => {
	it("shows a toast raised after its render and before its subscription", async () => {
		let titles: unknown[] = [];
		function Reader() {
			titles = useToast().toasts.map((t) => t.title);
			return null;
		}
		// A layout effect runs after the render and before any passive effect subscribes.
		function Raiser() {
			useLayoutEffect(() => {
				toast({ title: "Raised in the gap" });
			}, []);
			return null;
		}
		const root = createRoot(document.createElement("div"));
		await act(async () =>
			root.render(
				createElement(
					Fragment,
					null,
					createElement(Reader),
					createElement(Raiser),
				),
			),
		);
		expect(titles).toEqual(["Raised in the gap"]);
		await act(async () => root.unmount());
	});
});
