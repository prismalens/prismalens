// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CaseView } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./case";

const h = vi.hoisted(() => ({
	settingsData: undefined as { enabled: boolean } | undefined,
	settingsLoading: false,
	viewData: undefined as CaseView | undefined,
	viewLoading: false,
	viewError: null as Error | null,
	refetchView: vi.fn(),
}));

vi.mock("@/lib/api/hooks/use-case-files-orpc", () => ({
	useCaseFileSettings: () => ({
		data: h.settingsData,
		isLoading: h.settingsLoading,
	}),
	useCaseView: () => ({
		data: h.viewData,
		isLoading: h.viewLoading,
		error: h.viewError,
		refetch: h.refetchView,
	}),
	useCaseFileEnabled: () => h.settingsData?.enabled ?? false,
	useVerifyCase: () => ({ mutate: vi.fn(), isPending: false, error: null }),
	useCaseArtifact: () => ({ data: undefined, error: null, isLoading: false }),
}));

vi.mock("@/components/incidents/record-context", () => ({
	useIncidentRecord: () => ({
		incident: { id: "inc-1", title: "Test Incident" },
		openClose: vi.fn(),
		openReopen: vi.fn(),
		openEditCause: vi.fn(),
	}),
}));

vi.mock("@/components/run/IncidentHeader", () => ({
	IncidentHeader: () => <div data-testid="incident-header" />,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, ...props }: { children: ReactNode }) =>
			createElement("a", props, children),
	};
});

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
	h.settingsLoading = false;
	h.viewData = undefined;
	h.viewLoading = false;
	h.viewError = null;
	h.refetchView.mockClear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = () => {
	const Component = Route.options.component;
	if (!Component) throw new Error("Route component missing");
	return act(async () => root.render(createElement(Component)));
};

describe("Incident Case route (/incidents/$id/case)", () => {
	it("shows 'Case File is off.' when the setting is disabled", async () => {
		h.settingsData = { enabled: false };
		await render();
		const off = container.querySelector('[data-testid="case-off"]');
		expect(off).not.toBeNull();
		expect(off?.textContent).toContain("Case File is off.");
		expect(off?.textContent).toContain("Turn it on in Settings, Experiments");
	});

	it("shows 'Case File is off.' when setting data is missing", async () => {
		h.settingsData = undefined;
		await render();
		const off = container.querySelector('[data-testid="case-off"]');
		expect(off?.textContent).toContain("Case File is off.");
	});

	it("shows 'Case File is off.' when view reports enabled=false", async () => {
		h.settingsData = { enabled: true };
		h.viewData = {
			enabled: false,
			asOf: "2026-10-15T10:00:00.000Z",
			binding: null,
			captures: [],
			claims: [],
			openQuestions: [],
			agentToolCalls: [],
			manifest: { entries: 0, lastVerified: null },
		};
		await render();
		const off = container.querySelector('[data-testid="case-off"]');
		expect(off?.textContent).toContain("Case File is off.");
	});

	it("renders CaseFileView when enabled and loaded", async () => {
		h.settingsData = { enabled: true };
		h.viewData = {
			enabled: true,
			asOf: "2026-10-15T10:00:00.000Z",
			binding: {
				kubeContext: "kind-pl",
				namespace: "shop",
				cluster: "kind",
				probeState: "ok",
			},
			captures: [],
			claims: [],
			openQuestions: [],
			agentToolCalls: [],
			manifest: { entries: 0, lastVerified: null },
		};
		await render();
		expect(
			container.querySelector('[data-testid="case-file-view"]'),
		).not.toBeNull();
	});

	it("renders problem when case view fails to load and retries", async () => {
		h.settingsData = { enabled: true };
		h.viewError = new Error("Failed to load");
		await render();
		expect(container.textContent).toContain("The case did not load.");
		const retryBtn = container.querySelector<HTMLButtonElement>("button");
		await act(async () => retryBtn?.click());
		expect(h.refetchView).toHaveBeenCalled();
	});
});
