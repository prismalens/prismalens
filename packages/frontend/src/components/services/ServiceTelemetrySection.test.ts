// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ServiceIntegrationWithStatus,
	SourcesPreRun,
} from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ServiceTelemetrySection,
	selectorProblem,
	withoutEnabled,
} from "./ServiceTelemetrySection";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const updateMutate = vi.fn();
const createMutate = vi.fn();
const preRunData = {
	kinds: [] as SourcesPreRun["kinds"],
	checkoutsSkipped: [],
};

vi.mock("@/lib/api/hooks", () => ({
	useUpdateServiceIntegration: () => ({
		mutate: updateMutate,
		isPending: false,
	}),
	useCreateServiceIntegration: () => ({
		mutate: createMutate,
		isPending: false,
	}),
	useDeleteServiceIntegration: () => ({
		mutate: vi.fn(),
		isPending: false,
	}),
	useSetServiceIntegrationOrder: () => ({
		mutate: vi.fn(),
		isPending: false,
	}),
}));

vi.mock("@/lib/api/hooks/use-sources-orpc", () => ({
	useSourcesPreRun: () => ({
		data: preRunData,
	}),
}));

vi.mock("@tanstack/react-query", () => ({
	useQueries: () => [],
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	updateMutate.mockClear();
	createMutate.mockClear();
	preRunData.kinds = [];
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

const row = (serviceConfig: Record<string, unknown> | null) =>
	({ serviceConfig }) as ServiceIntegrationWithStatus;

describe("selectorProblem (#848 Connections)", () => {
	it("accepts valid label matcher lists", () => {
		expect(selectorProblem('{a="b", c=~"x.*"}')).toBeNull();
		expect(selectorProblem('{app="checkout"}')).toBeNull();
	});

	it("refuses bare metrics, unquoted values, and PromQL operators", () => {
		expect(selectorProblem("up")).not.toBeNull();
		expect(selectorProblem("{a=b}")).not.toBeNull();
		expect(selectorProblem('{a="b"} or up')).not.toBeNull();
	});
});

describe("ServiceTelemetrySection (cases 10, 12)", () => {
	it("toggles mapping-switch to send enabled: false", async () => {
		const integrations: ServiceIntegrationWithStatus[] = [
			{
				templateId: "prometheus",
				templateName: "Prometheus",
				connectionId: "c1",
				connectionName: "Prometheus Main",
				category: "observability",
				status: "ACTIVE",
				isGlobal: false,
				hasOverride: true,
				overrideId: "ov-1",
				serviceConfig: { enabled: true, deployment: "prod" },
				globalConfig: { baseUrl: "http://prom:9090" },
				effectiveConfig: { enabled: true, deployment: "prod" },
			},
		];

		await act(async () =>
			root.render(
				createElement(ServiceTelemetrySection, {
					serviceId: "svc-1",
					integrations,
				}),
			),
		);

		const switchEl = container.querySelector(
			'[data-testid="mapping-switch"]',
		) as HTMLButtonElement;
		expect(switchEl).not.toBeNull();

		await act(async () => switchEl.click());
		expect(updateMutate).toHaveBeenCalledWith({
			id: "ov-1",
			config: { enabled: false, deployment: "prod" },
		});
	});

	it("renders unmapped connection state and mapping-add posts empty config", async () => {
		const integrations: ServiceIntegrationWithStatus[] = [
			{
				templateId: "loki",
				templateName: "Loki",
				connectionId: "c2",
				connectionName: "Loki Logs",
				category: "observability",
				status: "ACTIVE",
				isGlobal: false,
				hasOverride: false,
				serviceConfig: null,
				globalConfig: { baseUrl: "http://loki:3100" },
				effectiveConfig: null,
			},
		];

		await act(async () =>
			root.render(
				createElement(ServiceTelemetrySection, {
					serviceId: "svc-1",
					integrations,
				}),
			),
		);

		expect(container.textContent).toContain("Not used by this service");

		const addBtn = container.querySelector(
			'[data-testid="mapping-add"]',
		) as HTMLButtonElement;
		expect(addBtn).not.toBeNull();

		await act(async () => addBtn.click());
		expect(createMutate).toHaveBeenCalledWith({
			serviceId: "svc-1",
			connectionId: "c2",
			config: {},
		});
	});

	it("draws service-matrix only when deploymentsSeen > 1", async () => {
		(preRunData as { deploymentsSeen?: string[] }).deploymentsSeen = [
			"prod-eu",
			"prod-us",
		];
		const integrations: ServiceIntegrationWithStatus[] = [
			{
				templateId: "prometheus",
				templateName: "Prometheus",
				connectionId: "c1",
				connectionName: "Prom 1",
				category: "observability",
				status: "ACTIVE",
				isGlobal: false,
				hasOverride: false,
				serviceConfig: null,
				globalConfig: { baseUrl: "http://prom:9090" },
				effectiveConfig: null,
			},
		];

		await act(async () =>
			root.render(
				createElement(ServiceTelemetrySection, {
					serviceId: "svc-1",
					integrations,
				}),
			),
		);

		expect(
			container.querySelector('[data-testid="service-matrix"]'),
		).not.toBeNull();
	});
});

describe("ServiceTelemetrySection turning a source back on", () => {
	it("keeps the service's other override keys", () => {
		expect(withoutEnabled(row({ enabled: false, namespace: "web" }))).toEqual({
			namespace: "web",
		});
	});

	it("drops the override when only `enabled` was in it", () => {
		expect(withoutEnabled(row({ enabled: false }))).toBeNull();
		expect(withoutEnabled(row(null))).toBeNull();
	});
});
