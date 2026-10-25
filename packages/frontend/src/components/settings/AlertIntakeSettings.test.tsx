// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SourceRow } from "@prismalens/contracts/schemas";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertIntakeSettings } from "./AlertIntakeSettings";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
	sources: [] as SourceRow[],
	delivery: null as { received: number; accepted: number; at: string } | null,
	webhookToken: { token: "test-token" } as { token: string } | null,
	envFallback: null as { origin: string } | null,
	dialogEnvOrigin: [] as (string | null | undefined)[],
};

vi.mock("./ConnectionFormDialog", async (importOriginal) => ({
	...(await importOriginal<typeof import("./ConnectionFormDialog")>()),
	ConnectionFormDialog: (props: {
		open: boolean;
		envOrigin?: string | null;
	}) => {
		if (props.open) state.dialogEnvOrigin.push(props.envOrigin);
		return null;
	},
}));

vi.mock("@/lib/api/hooks/use-sources-orpc", () => ({
	useSourcesOverview: () => ({
		data: { sources: state.sources, gitHosts: [] },
		isError: false,
		isPending: false,
	}),
	useTestSource: () => ({
		mutateAsync: vi.fn(),
		reset: vi.fn(),
		isPending: false,
	}),
	useConnectSource: () => ({
		mutateAsync: vi.fn(),
		reset: vi.fn(),
		isPending: false,
	}),
	useSourcesPreRun: () => ({
		data: {
			kinds: state.envFallback
				? [{ kind: "prometheus", envFallback: state.envFallback }]
				: [],
		},
	}),
}));

vi.mock("@/lib/api/hooks/use-webhooks-orpc", () => ({
	useWebhookToken: () => ({ data: state.webhookToken, isError: false }),
	useLastDelivery: () => ({ data: state.delivery }),
	webhookUrl: (kind: string) => `http://localhost:3000/api/webhooks/${kind}`,
	maskToken: (t: string) => t,
}));

vi.mock("@/lib/api/hooks", () => ({
	useConnections: () => ({ data: [] }),
	useIntegrations: () => ({ data: [] }),
	useTemplates: () => ({ data: [] }),
	useCreateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCreateIntegration: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteIntegration: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	state.sources = [];
	state.delivery = null;
	state.webhookToken = { token: "test-token" };
	state.envFallback = null;
	state.dialogEnvOrigin = [];
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AlertIntakeSettings (case 9 and delivery)", () => {
	it("lists only rows with alsoInAlertIntake under Pulled by URL and shows Also in Sources note", async () => {
		state.sources = [
			{
				connectionId: "conn-1",
				kind: "prometheus",
				label: "Pulled Prom",
				address: "http://prom:9090",
				status: "ACTIVE",
				testedAt: "2026-10-25T00:00:00Z",
				problem: null,
				lastErrorMessage: null,
				credential: "none",
				alsoInAlertIntake: true,
				usedBy: [],
			},
			{
				connectionId: "conn-2",
				kind: "loki",
				label: "Not Pulled Loki",
				address: "http://loki:3100",
				status: "ACTIVE",
				testedAt: "2026-10-25T00:00:00Z",
				problem: null,
				lastErrorMessage: null,
				credential: "none",
				alsoInAlertIntake: false,
				usedBy: [],
			},
		];

		await act(async () => root.render(createElement(AlertIntakeSettings)));

		const pulled = container.querySelector('[data-testid="sources-pulled"]');
		expect(pulled).not.toBeNull();

		const names = Array.from(
			pulled?.querySelectorAll('[data-testid="source-name"]') ?? [],
		).map((el) => el.textContent);
		expect(names).toEqual(["Pulled Prom"]);

		const alsoIn = pulled?.querySelector('[data-testid="source-also-in"]');
		expect(alsoIn?.textContent).toContain(
			"Also in Sources; editing it changes both",
		);

		const editBtn = pulled?.querySelector(
			'[data-testid="source-edit"]',
		) as HTMLButtonElement;
		expect(editBtn).not.toBeNull();
	});

	it("Edit passes the environment token's origin, as Sources does (case 5)", async () => {
		const row: SourceRow = {
			connectionId: "conn-env",
			kind: "prometheus",
			label: "Env Prom",
			address: "https://prom.example.com:9090/api",
			status: "ACTIVE",
			testedAt: "2026-10-25T00:00:00Z",
			problem: null,
			lastErrorMessage: null,
			credential: "env",
			alsoInAlertIntake: true,
			usedBy: [],
		};
		state.sources = [row];
		await act(async () => root.render(createElement(AlertIntakeSettings)));
		const edit = () =>
			(
				container.querySelector(
					'[data-testid="source-edit"]',
				) as HTMLButtonElement
			).click();
		await act(async () => edit());
		expect(state.dialogEnvOrigin.at(-1)).toBe("https://prom.example.com:9090");

		// A stored credential: the run's resolver names the env token's origin.
		state.sources = [
			{
				...row,
				credential: "stored",
				usedBy: [{ serviceId: "svc-1", name: "api" }],
			},
		];
		state.envFallback = { origin: "https://other.example.com" };
		await act(async () =>
			root.render(createElement(AlertIntakeSettings, { key: "2" })),
		);
		await act(async () => edit());
		expect(state.dialogEnvOrigin.at(-1)).toBe("https://other.example.com");
	});

	it("renders ok pill when received === accepted and warn pill when received !== accepted", async () => {
		state.delivery = {
			received: 5,
			accepted: 5,
			at: new Date().toISOString(),
		};

		await act(async () => root.render(createElement(AlertIntakeSettings)));
		let deliveryPill = container.querySelector(
			'[data-testid="webhook-last-delivery"]',
		);
		expect(deliveryPill?.textContent).toContain("5 alerts, accepted");

		state.delivery = {
			received: 5,
			accepted: 3,
			at: new Date().toISOString(),
		};

		await act(async () => root.render(createElement(AlertIntakeSettings)));
		deliveryPill = container.querySelector(
			'[data-testid="webhook-last-delivery"]',
		);
		expect(deliveryPill?.textContent).toContain("5 alerts, 3 accepted");
	});

	it("omits deploy events group when deploy is not in webhooksContract", async () => {
		await act(async () => root.render(createElement(AlertIntakeSettings)));
		expect(
			container.querySelector('[data-testid="sources-deploy"]'),
		).toBeNull();
	});
});
