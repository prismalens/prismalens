// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperimentsSettings } from "./ExperimentsSettings";

const h = vi.hoisted(() => ({
	settingsData: undefined as { enabled: boolean } | undefined,
	isError: true,
	isPending: false,
	error: null as Error | null,
	mutate: vi.fn(),
}));

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileSettings: () => ({ data: h.settingsData, isError: h.isError }),
	useUpdateCaseFileSettings: () => ({
		mutate: h.mutate,
		isPending: h.isPending,
		error: h.error,
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
	h.settingsData = undefined;
	h.isError = false;
	h.isPending = false;
	h.error = null;
	h.mutate.mockClear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = () =>
	act(async () => root.render(createElement(ExperimentsSettings)));

describe("ExperimentsSettings", () => {
	it("shows the Case File switch off when the setting cannot be read", async () => {
		h.isError = true;
		await render();
		const toggle = container.querySelector('[data-testid="case-file-switch"]');
		expect(toggle?.getAttribute("aria-checked")).toBe("false");
		expect(container.textContent).toContain(
			"Could not read this setting, so it shows off.",
		);
	});

	it("toggles from off to on and calls update.mutate({ enabled: true })", async () => {
		h.settingsData = { enabled: false };
		await render();
		const toggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="case-file-switch"]',
		);
		expect(toggle?.getAttribute("aria-checked")).toBe("false");
		await act(async () => toggle?.click());
		expect(h.mutate).toHaveBeenCalledWith({ enabled: true });
	});

	it("toggles from on to off and calls update.mutate({ enabled: false })", async () => {
		h.settingsData = { enabled: true };
		await render();
		const toggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="case-file-switch"]',
		);
		expect(toggle?.getAttribute("aria-checked")).toBe("true");
		await act(async () => toggle?.click());
		expect(h.mutate).toHaveBeenCalledWith({ enabled: false });
	});

	it("disables switch when update is pending or data is missing", async () => {
		h.settingsData = { enabled: true };
		h.isPending = true;
		await render();
		const toggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="case-file-switch"]',
		);
		expect(toggle?.disabled).toBe(true);
	});
});
