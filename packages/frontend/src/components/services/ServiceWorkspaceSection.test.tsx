// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	RunWorkspaceOverride,
	RunWorkspaceSettings,
} from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	FROM_GLOBAL,
	ServiceWorkspaceSection,
} from "./ServiceWorkspaceSection";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const globalSettings: RunWorkspaceSettings = {
	method: "worktree",
	location: null,
	retention: { kind: "remove-unless-changed" },
	setup: { posix: "pnpm install", windows: "pnpm install" },
	teardown: {},
	copyIn: [".env"],
	submodules: "skip",
	branch: "detached",
};

const state = {
	canEdit: true,
	defaultLocation: "/default/worktrees",
	globalSettings: { ...globalSettings },
	override: {} as RunWorkspaceOverride,
	updateMutate: vi.fn(),
};

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		setQueryData: vi.fn(),
	}),
	useQuery: (options: { queryKey?: () => unknown[] }) => {
		const key = options.queryKey ? options.queryKey() : [];
		if (Array.isArray(key) && key.includes("getService")) {
			return {
				data: {
					serviceId: "svc-1",
					override: state.override,
					effective: { ...state.globalSettings, ...state.override },
					inherited: Object.keys(state.globalSettings).filter(
						(k) => !(k in state.override),
					),
					canEdit: state.canEdit,
				},
			};
		}
		// global get
		return {
			data: {
				settings: state.globalSettings,
				defaultLocation: state.defaultLocation,
				canEdit: state.canEdit,
			},
		};
	},
	useMutation: () => ({
		mutate: state.updateMutate,
		isPending: false,
		error: null,
	}),
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		runWorkspaces: {
			get: {
				queryOptions: () => ({ queryKey: () => ["runWorkspaces", "get"] }),
			},
			getService: {
				queryOptions: () => ({
					queryKey: () => ["runWorkspaces", "getService"],
				}),
				queryKey: () => ["runWorkspaces", "getService"],
			},
			updateService: {
				mutationOptions: () => ({}),
			},
		},
	},
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	state.canEdit = true;
	state.defaultLocation = "/default/worktrees";
	state.globalSettings = { ...globalSettings };
	state.override = {};
	state.updateMutate = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("ServiceWorkspaceSection", () => {
	it('an inherited field reads "From global settings · <value>"', async () => {
		state.override = {};
		await act(async () =>
			root.render(
				createElement(ServiceWorkspaceSection, { serviceId: "svc-1" }),
			),
		);

		const methodRow = container.querySelector(
			'[data-testid="service-workspace-method"]',
		);
		expect(methodRow).not.toBeNull();
		expect(methodRow?.textContent).toContain(
			`${FROM_GLOBAL} · Worktree of your repo`,
		);

		const locationRow = container.querySelector(
			'[data-testid="service-workspace-location"]',
		);
		expect(locationRow).not.toBeNull();
		expect(locationRow?.textContent).toContain(
			`${FROM_GLOBAL} · /default/worktrees`,
		);
	});

	it('"Set for this service" shows the editor; Save sends only the overridden fields', async () => {
		state.override = {};
		await act(async () =>
			root.render(
				createElement(ServiceWorkspaceSection, { serviceId: "svc-1" }),
			),
		);

		const locationRow = container.querySelector(
			'[data-testid="service-workspace-location"]',
		);
		expect(locationRow).not.toBeNull();

		// Editor input should not be present before clicking "Set for this service"
		expect(
			locationRow?.querySelector('input[aria-label="Location"]'),
		).toBeNull();

		const setButton = Array.from(
			locationRow?.querySelectorAll("button") ?? [],
		).find((b) => b.textContent?.trim() === "Set for this service");
		expect(setButton).toBeDefined();

		// Click "Set for this service"
		await act(async () => {
			setButton?.click();
		});

		// Now the editor should be visible
		const locationInput = locationRow?.querySelector(
			'input[aria-label="Location"]',
		) as HTMLInputElement;
		expect(locationInput).not.toBeNull();

		// Change the value
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(locationInput, "/service-custom-location");
			locationInput.dispatchEvent(new Event("input", { bubbles: true }));
			locationInput.dispatchEvent(new Event("change", { bubbles: true }));
		});

		// Save button should appear and only send the overridden fields (location)
		const saveButton = container.querySelector(
			'[data-testid="service-workspace-save"]',
		) as HTMLButtonElement;
		expect(saveButton).not.toBeNull();

		await act(async () => {
			saveButton.click();
		});

		expect(state.updateMutate).toHaveBeenCalledTimes(1);
		expect(state.updateMutate).toHaveBeenCalledWith({
			serviceId: "svc-1",
			override: {
				location: "/service-custom-location",
			},
		});
	});
});
