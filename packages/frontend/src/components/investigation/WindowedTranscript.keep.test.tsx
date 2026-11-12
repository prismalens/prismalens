// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type TranscriptRowNode,
	type TranscriptWindow,
	WindowedTranscript,
} from "./WindowedTranscript";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const win: TranscriptWindow = {
	hasBefore: false,
	hasAfter: false,
	edges: { before: "idle", after: "idle" },
	change: "replace",
	onBefore: () => {},
	onAfter: () => {},
	folded: new Map(),
	onUnfold: async () => {},
	target: null,
	messages: 0,
	onToTail: () => {},
	connection: "idle",
	unsaved: 0,
	lost: 0,
};

const row = (key: string, keep?: boolean): TranscriptRowNode => ({
	key,
	at: null,
	node: <li data-testid={`row-${key}`}>{key}</li>,
	...(keep ? { keep } : {}),
});

// A row virtua unmounts off screen cancels the requests it started, so a lead
// row loading its own data (a child's parent bar) stays mounted (#1101 cat 12).
describe("the windowed transcript's kept rows", () => {
	let host: HTMLElement;
	let root: Root;
	beforeEach(() => {
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	it("mounts a kept lead row with no viewport to render it in, and not an unkept row", () => {
		act(() =>
			root.render(
				<WindowedTranscript
					rows={[
						row("lead", true),
						...Array.from({ length: 40 }, (_, i) => row(`r${i}`)),
					]}
					win={win}
					live={false}
				/>,
			),
		);
		expect(host.querySelector('[data-testid="row-lead"]')?.textContent).toBe(
			"lead",
		);
		expect(host.querySelector('[data-testid="row-r39"]')).toBeNull();
	});
});
