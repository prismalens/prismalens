// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView, SourceRow } from "@prismalens/contracts/schemas";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostDetail } from "./SourceDetail";
import { SourcesSettings } from "./SourcesSettings";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockData = {
	sources: [] as SourceRow[],
	gitHosts: [] as GitHostView[],
};

const pinMutate = vi.fn();

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		invalidateQueries: vi.fn(),
	}),
	useMutation: () => ({
		mutate: pinMutate,
		isPending: false,
	}),
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		sources: {
			key: () => ["sources"],
		},
		repositories: {
			setCredential: {
				mutationOptions: () => ({}),
			},
		},
	},
}));

vi.mock("@/lib/api/hooks/use-sources-orpc", () => ({
	useSourcesOverview: () => ({
		data: mockData,
		isError: false,
		isPending: false,
		refetch: vi.fn(),
	}),
	useSourcesPreRun: () => ({
		data: { envFallback: [] },
	}),
	useSetRepositoryCredential: () => ({
		mutate: pinMutate,
		isPending: false,
	}),
	useTestConnection: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
	}),
	useTestSource: () => ({
		mutateAsync: vi.fn(),
		reset: vi.fn(),
		isPending: false,
		error: null,
	}),
	useConnectSource: () => ({
		mutateAsync: vi.fn(),
		reset: vi.fn(),
		isPending: false,
		error: null,
	}),
}));

vi.mock("@/lib/api/hooks", () => ({
	useIntegrations: () => ({ data: [] }),
	useTemplates: () => ({ data: [] }),
	useConnections: () => ({ data: [] }),
	useDeleteConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCreateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCreateIntegration: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteIntegration: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useTestConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useConnectionDeletionImpact: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/hooks/use-media-query", () => ({
	PHONE: "(max-width: 767px)",
	SIDEBAR_FULL: "(min-width: 1280px)",
	useMediaQuery: () => false,
}));

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
	vi.restoreAllMocks();
});

describe("SourcesSettings (cases 4, 9, and Many layout)", () => {
	it("renders Overrides note when overridesEnv is present (case 4)", async () => {
		mockData.sources = [
			{
				connectionId: "s1",
				kind: "prometheus",
				label: "Prometheus",
				address: "http://localhost:9090",
				status: "ACTIVE",
				testedAt: "2026-10-25T00:00:00Z",
				problem: null,
				lastErrorMessage: null,
				credential: "stored",
				credentialKind: "bearer",
				overridesEnv: "PROMETHEUS_TOKEN",
				alsoInAlertIntake: false,
				usedBy: [],
			},
		];
		mockData.gitHosts = [];

		await act(async () => root.render(createElement(SourcesSettings)));
		const overrides = container.querySelector(
			'[data-testid="source-overrides"]',
		);
		expect(overrides).not.toBeNull();
		expect(overrides?.textContent).toContain("PROMETHEUS_TOKEN");
	});

	it("renders Also in Alert intake only when not overridden (case 9)", async () => {
		mockData.sources = [
			{
				connectionId: "s2",
				kind: "alertmanager",
				label: "Alertmanager",
				address: "http://localhost:9093",
				status: "ACTIVE",
				testedAt: "2026-10-25T00:00:00Z",
				problem: null,
				lastErrorMessage: null,
				credential: "none",
				alsoInAlertIntake: true,
				usedBy: [],
			},
			{
				connectionId: "s3",
				kind: "prometheus",
				label: "Prom 2",
				address: "http://localhost:9091",
				status: "ACTIVE",
				testedAt: "2026-10-25T00:00:00Z",
				problem: null,
				lastErrorMessage: null,
				credential: "stored",
				credentialKind: "bearer",
				overridesEnv: "PROM_KEY",
				alsoInAlertIntake: true,
				usedBy: [],
			},
		];
		mockData.gitHosts = [];

		await act(async () => root.render(createElement(SourcesSettings)));
		const alsoInNotes = container.querySelectorAll(
			'[data-testid="source-also-in"]',
		);
		expect(alsoInNotes.length).toBe(1);
		expect(alsoInNotes[0]?.textContent).toContain("Also in Alert intake");
	});

	it("switches to sources-many layout with tiles when > 8 items exist", async () => {
		mockData.sources = Array.from({ length: 9 }).map((_, i) => ({
			connectionId: `s-${i}`,
			kind: "prometheus",
			label: `Prometheus ${i}`,
			address: `http://localhost:${9090 + i}`,
			status: i === 0 ? "ERROR" : "ACTIVE",
			testedAt: "2026-10-25T00:00:00Z",
			problem: i === 0 ? "cant-reach" : null,
			lastErrorMessage: null,
			credential: "none",
			alsoInAlertIntake: false,
			usedBy: [],
		}));
		mockData.gitHosts = [];

		await act(async () => root.render(createElement(SourcesSettings)));
		const many = container.querySelector('[data-testid="sources-many"]');
		expect(many).not.toBeNull();
		expect(
			container.querySelector('[data-testid="sources-tile-all"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="sources-tile-attention"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="sources-tile-unused"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="sources-search"]'),
		).not.toBeNull();
	});

	it("opens the source a coverage Fix names, Few and Many (#848)", async () => {
		const row = (i: number): SourceRow => ({
			connectionId: `s-${i}`,
			kind: "prometheus",
			label: `Prometheus ${i}`,
			address: `http://localhost:${9090 + i}`,
			status: "ACTIVE",
			testedAt: "2026-10-25T00:00:00Z",
			problem: null,
			lastErrorMessage: null,
			credential: "none",
			alsoInAlertIntake: false,
			usedBy: [],
		});
		mockData.gitHosts = [];
		mockData.sources = [0, 1, 2].map(row);
		await act(async () =>
			root.render(createElement(SourcesSettings, { source: "s-1" })),
		);
		const open = Array.from(
			container.querySelectorAll('[data-testid="source-row"]'),
		).filter((r) => r.querySelector('[data-testid="source-detail"]'));
		expect(open.map((r) => r.getAttribute("data-source"))).toEqual([
			"Prometheus 1",
		]);

		await act(async () => root.unmount());
		root = createRoot(container);
		mockData.sources = Array.from({ length: 9 }, (_, i) => row(i));
		await act(async () =>
			root.render(createElement(SourcesSettings, { source: "s-4" })),
		);
		const selected = container.querySelectorAll('[aria-selected="true"]');
		expect(
			Array.from(selected).map((r) => r.getAttribute("data-source")),
		).toEqual(["Prometheus 4"]);
	});

	it("renders pick-token-select for unpinned repositories (case 8)", async () => {
		const host: GitHostView = {
			host: "github.com",
			order: ["stored"],
			ambiguous: true,
			stored: [
				{
					connectionId: "conn-1",
					label: "Personal Token",
					fingerprint: "fp-1",
					status: "ACTIVE",
					testedAt: "2026-10-25T00:00:00Z",
					pinnedRepos: [],
				},
			],
			env: null,
			machine: null,
			unpinnedRepos: [
				{
					repositoryId: "repo-1",
					url: "https://github.com/org/repo1",
				},
			],
		};

		await act(async () =>
			root.render(
				createElement(HostDetail, {
					host,
					actions: {
						onEdit: vi.fn(),
						onDelete: vi.fn(),
						onAddToken: vi.fn(),
					},
				}),
			),
		);

		const select = container.querySelector('[data-testid="pick-token-select"]');
		expect(select).not.toBeNull();
	});
});
