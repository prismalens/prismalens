// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DangerZoneSettings } from "./DangerZoneSettings";

const h = vi.hoisted(() => ({
	factoryReset: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/components/settings/AboutSettings", () => ({
	CHANNEL_LABEL: {},
	CommandLine: () => null,
	useAbout: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/hooks", () => ({
	useResetData: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
	useFactoryReset: () => ({
		mutateAsync: h.factoryReset,
		isPending: false,
		error: null,
	}),
}));
vi.mock("@/components/shared/DestructiveConfirm", async () => {
	const { createElement: el } = await import("react");
	return {
		DestructiveConfirm: (p: {
			open: boolean;
			confirmLabel: string;
			onConfirm: () => unknown;
		}) =>
			p.open
				? el(
						"button",
						{
							type: "button",
							"data-testid": `confirm-${p.confirmLabel}`,
							onClick: () => p.onConfirm(),
						},
						p.confirmLabel,
					)
				: null,
	};
});
vi.mock("@/components/shared/SettingRow", () => ({
	SettingGroup: ({ children }: { children: ReactNode }) => children,
	SettingRow: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const realLocation = window.location;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	Object.defineProperty(window, "location", {
		configurable: true,
		value: { href: "http://localhost/settings?tab=danger" },
	});
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	Object.defineProperty(window, "location", {
		configurable: true,
		value: realLocation,
	});
});

describe("Factory reset (#673 w6-32)", () => {
	it("lands on the Inbox, not the removed setup page", async () => {
		await act(async () => root.render(createElement(DangerZoneSettings)));
		const open = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Factory reset",
		);
		await act(async () => open?.click());
		const confirm = container.querySelector(
			'[data-testid="confirm-Factory reset"]',
		) as HTMLButtonElement;
		await act(async () => confirm.click());
		expect(h.factoryReset).toHaveBeenCalledWith({
			confirmation: "FACTORY RESET",
		});
		expect(window.location.href).toBe("/");
	});
});
