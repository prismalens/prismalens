// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceCaptureSection } from "./ServiceCaptureSection";

const h = vi.hoisted(() => ({
	enabled: true,
	confirm: vi.fn(),
}));

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileEnabled: () => h.enabled,
	useServiceBinding: () => ({ data: null, isLoading: false, error: null }),
	useBindingDetection: () => ({
		isLoading: false,
		error: null,
		data: {
			kubectl: { path: "/usr/bin/kubectl", version: "v1.31.0" },
			contexts: ["kind-pl", "prod"],
			currentContext: "kind-pl",
			current: { cluster: "kind", user: "admin", namespace: "shop" },
		},
	}),
	useConfirmBinding: () => ({
		mutate: h.confirm,
		isPending: false,
		error: null,
	}),
	useProbeBinding: () => ({ mutate: vi.fn(), isPending: false, error: null }),
	useRemoveBinding: () => ({ mutate: vi.fn(), isPending: false, error: null }),
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
	h.enabled = true;
	h.confirm.mockClear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const SERVICE = "7b1e6f0a-0000-4000-8000-000000000001";
const render = () =>
	act(async () =>
		root.render(createElement(ServiceCaptureSection, { serviceId: SERVICE })),
	);

describe("ServiceCaptureSection (smoke)", () => {
	it("renders nothing while the setting is off", async () => {
		h.enabled = false;
		await render();
		expect(container.innerHTML).toBe("");
	});

	it("confirms the detected context and namespace", async () => {
		await render();
		expect(container.textContent).toContain(
			"Detected from kubectl on this machine.",
		);
		const button = container.querySelector<HTMLButtonElement>(
			'[data-testid="capture-confirm"]',
		);
		await act(async () => button?.click());
		expect(h.confirm).toHaveBeenCalledWith({
			serviceId: SERVICE,
			kubeContext: "kind-pl",
			namespace: "shop",
		});
	});
});
