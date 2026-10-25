// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	serviceIntegrationsKeys,
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useSetServiceIntegrationOrder,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks/use-integrations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import {
	movedOrder,
	orderRows,
	ServiceTelemetrySection,
} from "./ServiceTelemetrySection";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const reorderMutate = vi.fn();
let reorderPending = false;

vi.mock("@/lib/api/hooks", () => ({
	useUpdateServiceIntegration: () => ({ mutate: vi.fn(), isPending: false }),
	useCreateServiceIntegration: () => ({ mutate: vi.fn(), isPending: false }),
	useDeleteServiceIntegration: () => ({ mutate: vi.fn(), isPending: false }),
	useSetServiceIntegrationOrder: () => ({
		mutate: reorderMutate,
		isPending: reorderPending,
	}),
}));

vi.mock("@/lib/api/hooks/use-sources-orpc", () => ({
	useSourcesPreRun: () => ({
		data: { kinds: [], checkoutsSkipped: [] },
	}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQueries: () => [],
	};
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	reorderMutate.mockReset();
	reorderPending = false;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

const makeRow = (
	overrideId: string | undefined,
	priority?: number,
	name = "conn",
): ServiceIntegrationWithStatus => ({
	templateId: "prometheus",
	templateName: "Prometheus",
	connectionId: `c-${name}`,
	connectionName: name,
	category: "observability",
	status: "ACTIVE",
	isGlobal: false,
	hasOverride: !!overrideId,
	overrideId,
	priority,
	serviceConfig: overrideId ? { enabled: true } : null,
	globalConfig: { baseUrl: "http://prom:9090" },
	effectiveConfig: overrideId ? { enabled: true } : null,
});

describe("orderRows and movedOrder (case 11)", () => {
	it("sorts mapped rows by priority descending with missing as 0 and ties in input order, followed by unmapped", () => {
		const r1 = makeRow("ov-1", 10, "r1");
		const r2 = makeRow("ov-2", undefined, "r2"); // priority 0
		const r3 = makeRow("ov-3", 20, "r3");
		const r4 = makeRow("ov-4", 10, "r4"); // tie with r1
		const u1 = makeRow(undefined, undefined, "u1");
		const u2 = makeRow(undefined, undefined, "u2");

		const sorted = orderRows([u1, r1, r2, u2, r3, r4]);
		// Mapped: r3 (20), r1 (10), r4 (10, tie keeps input order), r2 (0)
		// Unmapped: u1, u2
		expect(sorted.map((r) => r.connectionName)).toEqual([
			"r3",
			"r1",
			"r4",
			"r2",
			"u1",
			"u2",
		]);
	});

	it("swaps id with movedOrder and returns null at ends or unknown id", () => {
		const mapped = [
			makeRow("ov-1", 20, "r1"),
			makeRow("ov-2", 10, "r2"),
			makeRow("ov-3", 5, "r3"),
		];

		// Move r2 up
		expect(movedOrder(mapped, "ov-2", -1)).toEqual(["ov-2", "ov-1", "ov-3"]);
		// Move r2 down
		expect(movedOrder(mapped, "ov-2", 1)).toEqual(["ov-1", "ov-3", "ov-2"]);

		// Top moved up is null
		expect(movedOrder(mapped, "ov-1", -1)).toBeNull();
		// Bottom moved down is null
		expect(movedOrder(mapped, "ov-3", 1)).toBeNull();
		// Unknown id is null
		expect(movedOrder(mapped, "unknown", 1)).toBeNull();
	});
});

describe("ServiceTelemetrySection reordering UI (case 11)", () => {
	it("shows mapping-order-hint when kind has 2 or more mappings, and none when 1", async () => {
		const twoMappings = [
			makeRow("ov-1", 10, "Prom A"),
			makeRow("ov-2", 5, "Prom B"),
		];

		await act(async () =>
			root.render(
				createElement(ServiceTelemetrySection, {
					serviceId: "svc-1",
					integrations: twoMappings,
				}),
			),
		);

		const hint = container.querySelector('[data-testid="mapping-order-hint"]');
		expect(hint).not.toBeNull();
		expect(hint?.textContent).toBe("Higher rows win.");

		// Render with only one mapping
		await act(async () =>
			root.render(
				createElement(ServiceTelemetrySection, {
					serviceId: "svc-1",
					integrations: [makeRow("ov-1", 10, "Prom A")],
				}),
			),
		);
		expect(
			container.querySelector('[data-testid="mapping-order-hint"]'),
		).toBeNull();
	});

	it("opens OrderControls on row edit button, disables ends, and moves down on click", async () => {
		const integrations = [
			makeRow("ov-1", 10, "Prom A"),
			makeRow("ov-2", 5, "Prom B"),
			makeRow("ov-3", 1, "Prom C"),
		];

		reorderMutate.mockImplementation(
			(_vars: unknown, opts?: { onSuccess?: () => void }) => {
				opts?.onSuccess?.();
			},
		);

		await act(async () =>
			root.render(
				createElement(ServiceTelemetrySection, {
					serviceId: "svc-1",
					integrations,
				}),
			),
		);

		// Open first row: Prom A
		const editBtn0 = container.querySelector(
			'button[aria-label="Edit the mapping of Prom A"]',
		) as HTMLButtonElement;
		expect(editBtn0).not.toBeNull();

		await act(async () => editBtn0.click());

		const fieldset = container.querySelector('[data-testid="mapping-order"]');
		expect(fieldset).not.toBeNull();
		expect(fieldset?.querySelector("legend")?.textContent).toBe(
			"Order of Prom A",
		);

		const upBtn = container.querySelector(
			'[data-testid="mapping-move-up"]',
		) as HTMLButtonElement;
		const downBtn = container.querySelector(
			'[data-testid="mapping-move-down"]',
		) as HTMLButtonElement;

		// Row 0: Up is disabled, Down is enabled
		expect(upBtn.disabled).toBe(true);
		expect(downBtn.disabled).toBe(false);

		// Click down
		await act(async () => downBtn.click());

		expect(reorderMutate).toHaveBeenCalledTimes(1);
		expect(reorderMutate).toHaveBeenCalledWith(
			{
				serviceId: "svc-1",
				overrideIds: ["ov-2", "ov-1", "ov-3"],
			},
			expect.anything(),
		);

		const liveRegion = container.querySelector('p[aria-live="polite"]');
		expect(liveRegion?.textContent).toBe("Prom A moved down");
	});

	it("disables both move buttons when reorder is pending", async () => {
		reorderPending = true;
		const integrations = [
			makeRow("ov-1", 10, "Prom A"),
			makeRow("ov-2", 5, "Prom B"),
		];

		await act(async () =>
			root.render(
				createElement(ServiceTelemetrySection, {
					serviceId: "svc-1",
					integrations,
				}),
			),
		);

		const editBtn = container.querySelector(
			'button[aria-label="Edit the mapping of Prom A"]',
		) as HTMLButtonElement;
		await act(async () => editBtn.click());

		const upBtn = container.querySelector(
			'[data-testid="mapping-move-up"]',
		) as HTMLButtonElement;
		const downBtn = container.querySelector(
			'[data-testid="mapping-move-down"]',
		) as HTMLButtonElement;

		expect(upBtn.disabled).toBe(true);
		expect(downBtn.disabled).toBe(true);
	});
});

type Mutate = (vars: never) => Promise<unknown>;

/**
 * The server holds the order; the rows and one matrix column are cached, as on
 * the service page. A mutation must refetch both, or the screen keeps the old answer.
 */
async function afterMutation(
	useHook: () => { mutateAsync: Mutate },
	vars: unknown,
) {
	const server = { order: "ov-1,ov-2" };
	const rowsFn = vi.fn(async () => server.order);
	const matrixFn = vi.fn(async () => server.order.split(",")[0]);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			server.order = "ov-2,ov-1";
			return Response.json({});
		}),
	);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
	});
	let mutateAsync: Mutate | undefined;
	function View() {
		const rows = useQuery({
			queryKey: [...serviceIntegrationsKeys.forService("svc-1")],
			queryFn: rowsFn,
		});
		const matrix = useQuery({
			queryKey: [
				...orpc.sources.preRun.queryKey({
					input: { serviceId: "svc-1", deployment: "prod" },
				}),
			],
			queryFn: matrixFn,
		});
		mutateAsync = useHook().mutateAsync;
		return createElement(
			"p",
			{ "data-testid": "view" },
			`${rows.data ?? ""}|${matrix.data ?? ""}`,
		);
	}
	await act(async () =>
		root.render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(View),
			),
		),
	);
	const view = () =>
		container.querySelector('[data-testid="view"]')?.textContent;
	for (let i = 0; i < 50 && view() !== "ov-1,ov-2|ov-1"; i++)
		await act(() => new Promise((r) => setTimeout(r, 5)));
	expect(view()).toBe("ov-1,ov-2|ov-1");
	await act(async () => {
		await mutateAsync?.(vars as never);
	});
	for (let i = 0; i < 50 && view() !== "ov-2,ov-1|ov-2"; i++)
		await act(() => new Promise((r) => setTimeout(r, 5)));
	return {
		view: view(),
		rows: rowsFn.mock.calls.length,
		matrix: matrixFn.mock.calls.length,
	};
}

describe("mapping mutations refresh the rows and the matrix (#848 case 11, 12)", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("a move refetches the rows and the preview, so the new order shows", async () => {
		const r = await afterMutation(useSetServiceIntegrationOrder, {
			serviceId: "svc-1",
			overrideIds: ["ov-2", "ov-1"],
		});
		expect(r).toEqual({ view: "ov-2,ov-1|ov-2", rows: 2, matrix: 2 });
	});

	it("adding a mapping refetches the preview", async () => {
		const r = await afterMutation(useCreateServiceIntegration, {
			serviceId: "svc-1",
			connectionId: "c-1",
			config: {},
		});
		expect(r).toEqual({ view: "ov-2,ov-1|ov-2", rows: 2, matrix: 2 });
	});

	it("switching a mapping off refetches the preview", async () => {
		const r = await afterMutation(useUpdateServiceIntegration, {
			id: "ov-1",
			config: { enabled: false },
		});
		expect(r).toEqual({ view: "ov-2,ov-1|ov-2", rows: 2, matrix: 2 });
	});

	it("removing a mapping refetches the preview", async () => {
		const r = await afterMutation(useDeleteServiceIntegration, { id: "ov-1" });
		expect(r).toEqual({ view: "ov-2,ov-1|ov-2", rows: 2, matrix: 2 });
	});
});
