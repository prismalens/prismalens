// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BINDING_PROBE_STATES,
	type BindingDetection,
	type BindingProbeState,
	type ServiceBinding,
} from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PROBE_WORDS,
	prefill,
	ServiceCaptureSection,
} from "./ServiceCaptureSection";

const h = vi.hoisted(() => ({
	enabled: true,
	binding: null as ServiceBinding | null,
	bindingLoading: false,
	bindingError: null as Error | null,
	bindingRefetch: vi.fn(),
	detection: {
		kubectl: { path: "/usr/bin/kubectl", version: "v1.31.0" },
		contexts: ["kind-pl", "prod"],
		currentContext: "kind-pl",
		current: { cluster: "kind", user: "admin", namespace: "shop" },
		suggested: null,
	} as BindingDetection | null,
	detectError: null as Error | null,
	detectRefetch: vi.fn(),
	confirm: vi.fn(),
	probe: vi.fn(),
	remove: vi.fn(),
	probePending: false,
	removePending: false,
}));

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileEnabled: () => h.enabled,
	useServiceBinding: () => ({
		data: h.binding,
		isLoading: h.bindingLoading,
		error: h.bindingError,
		refetch: h.bindingRefetch,
	}),
	useBindingDetection: () => ({
		isLoading: false,
		error: h.detectError,
		data: h.detection,
		refetch: h.detectRefetch,
	}),
	useConfirmBinding: () => ({
		mutate: h.confirm,
		isPending: false,
		error: null,
	}),
	useProbeBinding: () => ({
		mutate: h.probe,
		isPending: h.probePending,
		error: null,
	}),
	useRemoveBinding: () => ({
		mutate: h.remove,
		isPending: h.removePending,
		error: null,
	}),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SERVICE = "7b1e6f0a-0000-4000-8000-000000000001";

const mockBinding = (
	probeState: BindingProbeState,
	probeDetail: string | null = null,
): ServiceBinding => ({
	id: "b1",
	serviceId: SERVICE,
	kind: "kubernetes",
	kubeContext: "kind-pl",
	cluster: "kind",
	namespace: "shop",
	kubeUser: "admin",
	detected: { kubectl: null, contexts: [] },
	confirmedAt: "2026-10-15T10:00:00.000Z",
	probeState,
	probeDetail,
	probedAt: "2026-10-15T10:00:00.000Z",
	createdAt: "2026-10-15T10:00:00.000Z",
	updatedAt: "2026-10-15T10:00:00.000Z",
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	h.enabled = true;
	h.binding = null;
	h.detection = {
		kubectl: { path: "/usr/bin/kubectl", version: "v1.31.0" },
		contexts: ["kind-pl", "prod"],
		currentContext: "kind-pl",
		current: { cluster: "kind", user: "admin", namespace: "shop" },
		suggested: null,
	};
	h.detectError = null;
	h.bindingError = null;
	h.bindingLoading = false;
	h.detectRefetch.mockClear();
	h.bindingRefetch.mockClear();
	h.confirm.mockClear();
	h.probe.mockClear();
	h.remove.mockClear();
	h.probePending = false;
	h.removePending = false;
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = () =>
	act(async () =>
		root.render(createElement(ServiceCaptureSection, { serviceId: SERVICE })),
	);

describe("ServiceCaptureSection", () => {
	it("renders nothing while the setting is off", async () => {
		h.enabled = false;
		await render();
		expect(container.innerHTML).toBe("");
	});

	describe("prefill priority", () => {
		it("prioritises suggested over currentContext and contexts[0]", () => {
			const res = prefill({
				kubectl: null,
				contexts: ["ctx-0"],
				currentContext: "ctx-curr",
				suggested: { kubeContext: "ctx-sugg", namespace: "ns-sugg" },
			});
			expect(res).toEqual({ kubeContext: "ctx-sugg", namespace: "ns-sugg" });
		});

		it("prioritises currentContext over contexts[0] when suggested is absent", () => {
			const res = prefill({
				kubectl: null,
				contexts: ["ctx-0"],
				currentContext: "ctx-curr",
				current: { cluster: "k", user: "u", namespace: "ns-curr" },
			});
			expect(res).toEqual({ kubeContext: "ctx-curr", namespace: "ns-curr" });
		});

		it("uses contexts[0] and default namespace when no suggested or currentContext", () => {
			const res = prefill({
				kubectl: null,
				contexts: ["ctx-0", "ctx-1"],
				currentContext: null,
				current: null,
			});
			expect(res).toEqual({ kubeContext: "ctx-0", namespace: "default" });
		});

		it("falls back to empty context and default namespace when empty", () => {
			const res = prefill({
				kubectl: null,
				contexts: [],
				currentContext: null,
				current: null,
			});
			expect(res).toEqual({ kubeContext: "", namespace: "default" });
		});
	});

	describe("probe-state text for all 7 BINDING_PROBE_STATES", () => {
		for (const state of BINDING_PROBE_STATES) {
			it(`renders probe text for ${state}`, async () => {
				h.binding = mockBinding(state);
				await render();
				const probeEl = container.querySelector(
					'[data-testid="capture-probe"]',
				);
				expect(probeEl?.textContent).toBe(PROBE_WORDS[state]);
			});
		}

		it("appends probeDetail when present", async () => {
			h.binding = mockBinding("unreachable", "i/o timeout");
			await render();
			const probeEl = container.querySelector('[data-testid="capture-probe"]');
			expect(probeEl?.textContent).toBe(
				`${PROBE_WORDS.unreachable} i/o timeout`,
			);
		});
	});

	describe("Check again and Unbind mutations", () => {
		it("calls probe mutation on Check again click", async () => {
			h.binding = mockBinding("ok");
			await render();
			const btn = container.querySelector<HTMLButtonElement>(
				'[data-testid="capture-probe-again"]',
			);
			await act(async () => btn?.click());
			expect(h.probe).toHaveBeenCalledWith({ serviceId: SERVICE });
		});

		it("calls remove mutation on Unbind click", async () => {
			h.binding = mockBinding("ok");
			await render();
			const btn = container.querySelector<HTMLButtonElement>(
				'[data-testid="capture-unbind"]',
			);
			await act(async () => btn?.click());
			expect(h.remove).toHaveBeenCalledWith({ serviceId: SERVICE });
		});

		it("disables both buttons while mutation is pending", async () => {
			h.binding = mockBinding("ok");
			h.probePending = true;
			await render();
			const checkAgain = container.querySelector<HTMLButtonElement>(
				'[data-testid="capture-probe-again"]',
			);
			const unbind = container.querySelector<HTMLButtonElement>(
				'[data-testid="capture-unbind"]',
			);
			expect(checkAgain?.disabled).toBe(true);
			expect(unbind?.disabled).toBe(true);
		});
	});

	describe("no-kubectl and no-contexts branches", () => {
		it("renders no-kubectl message when kubectl is null", async () => {
			h.detection = { kubectl: null, contexts: [] };
			await render();
			const el = container.querySelector('[data-testid="capture-no-kubectl"]');
			expect(el?.textContent).toContain(
				"kubectl is not on this machine's PATH",
			);
		});

		it("renders no-contexts message when contexts array is empty", async () => {
			h.detection = {
				kubectl: { path: "/usr/bin/kubectl", version: "v1.31.0" },
				contexts: [],
			};
			await render();
			expect(container.textContent).toContain(
				"kubectl on this machine has no contexts.",
			);
		});
		it("renders problem when detection fails and retries", async () => {
			h.detectError = new Error("kubectl failed");
			await render();
			expect(container.textContent).toContain(
				"Could not ask kubectl on this machine for its contexts.",
			);
			const retryBtn = container.querySelector<HTMLButtonElement>("button");
			await act(async () => retryBtn?.click());
			expect(h.detectRefetch).toHaveBeenCalled();
		});
	});

	it("confirms with custom namespace when changed", async () => {
		await render();
		const nsInput = container.querySelector<HTMLInputElement>(
			'[data-testid="capture-namespace"]',
		);
		expect(nsInput).not.toBeNull();
		await act(async () => {
			if (nsInput) {
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				setter?.call(nsInput, "custom-ns");
				nsInput.dispatchEvent(new Event("input", { bubbles: true }));
				nsInput.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
		const form = container.querySelector<HTMLFormElement>(
			'[data-testid="capture-bind-form"]',
		);
		await act(async () =>
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			),
		);
		expect(h.confirm).toHaveBeenCalledWith({
			serviceId: SERVICE,
			kubeContext: "kind-pl",
			namespace: "custom-ns",
		});
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

	it("renders problem when binding query errors and retries", async () => {
		h.bindingError = new Error("Failed to load binding");
		await render();
		expect(container.textContent).toContain("The binding did not load.");
		const retryBtn = container.querySelector<HTMLButtonElement>("button");
		await act(async () => retryBtn?.click());
		expect(h.bindingRefetch).toHaveBeenCalled();
	});
});
