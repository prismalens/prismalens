// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RowAskState } from "./RowAsk";
import { RowAsk } from "./RowAskCard";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children?: ReactNode }) => children,
}));

const ask = {
	askId: "00000000-0000-4000-8000-000000000001",
	threadId: "00000000-0000-4000-8000-000000000002",
	kind: "permission",
	requiresHost: false,
	source: { kind: "agent" },
	title: "Run the migration",
	openedAt: "2026-11-12T11:58:00.000Z",
} as PendingAsk;

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
});

describe("RowAsk, the ask card", () => {
	it("puts the cursor in the reason field when Deny with reason opens it", async () => {
		const decline = vi.fn();
		await act(async () =>
			root.render(
				createElement(RowAsk, {
					state: {
						ask,
						busy: false,
						onHost: true,
						decline,
					} as unknown as RowAskState,
					ended: false,
					accessLevel: null,
					now: Date.parse("2026-11-12T12:00:00.000Z"),
					count: 1,
					openHref: () => {},
				}),
			),
		);
		await act(async () => {
			host
				.querySelector<HTMLButtonElement>('[data-testid="row-ask-deny-reason"]')
				?.click();
		});
		expect(document.activeElement?.getAttribute("data-testid")).toBe(
			"row-ask-reason",
		);
	});
});
