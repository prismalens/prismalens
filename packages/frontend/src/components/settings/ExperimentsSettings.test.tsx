// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettings } from "./ExperimentsSettings";

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileSettings: () => ({ data: undefined, isError: true }),
	useUpdateCaseFileSettings: () => ({
		mutate: vi.fn(),
		isPending: false,
		error: null,
	}),
}));
vi.mock("@/components/shared/SettingRow", () => ({
	SettingGroup: ({ children }: { children: ReactNode }) => children,
	SettingRow: ({ children }: { children: ReactNode }) => children,
}));

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

describe("ExperimentsSettings (smoke)", () => {
	it("shows the Case File switch off when the setting cannot be read", async () => {
		await act(async () => root.render(createElement(ExperimentsSettings)));
		const toggle = container.querySelector('[data-testid="case-file-switch"]');
		expect(toggle?.getAttribute("aria-checked")).toBe("false");
	});
});
