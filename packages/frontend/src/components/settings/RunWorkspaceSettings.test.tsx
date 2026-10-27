// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	RunWorkspaceSettings as Settings,
	WorkspaceRemoval,
} from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunWorkspaceSettings } from "./RunWorkspaceSettings";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const defaultSettings: Settings = {
	method: "worktree",
	location: null,
	retention: { kind: "remove-unless-changed" },
	keptPerProject: 3,
	setup: { posix: "pnpm install", windows: "pnpm install" },
	teardown: {},
	copyIn: [".env"],
	submodules: "skip",
	branch: "detached",
};

const state = {
	canEdit: true,
	defaultLocation: "/default/worktrees",
	settings: { ...defaultSettings },
	removals: [] as WorkspaceRemoval[],
	updateMutate: vi.fn(),
};

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		setQueryData: vi.fn(),
		invalidateQueries: vi.fn(),
	}),
	useQuery: (options: { queryKey?: () => unknown[] }) => {
		const key = options.queryKey ? options.queryKey() : [];
		if (Array.isArray(key) && key.includes("removals")) {
			return { data: { removals: state.removals } };
		}
		return {
			data: {
				settings: state.settings,
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
				queryKey: () => ["runWorkspaces", "get"],
			},
			update: {
				mutationOptions: () => ({}),
			},
			removals: {
				queryOptions: () => ({ queryKey: () => ["runWorkspaces", "removals"] }),
			},
			key: () => ["runWorkspaces"],
		},
	},
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	state.canEdit = true;
	state.defaultLocation = "/default/worktrees";
	state.settings = { ...defaultSettings };
	state.removals = [];
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

describe("RunWorkspaceSettings", () => {
	it("renders every field label", async () => {
		await act(async () => root.render(createElement(RunWorkspaceSettings)));

		const expectedLabels = [
			"Method",
			"Location",
			"After a run",
			"Kept per service",
			"Setup command",
			"Teardown command",
			"Files to copy in",
			"Submodules",
			"Branch",
		];

		for (const label of expectedLabels) {
			expect(container.textContent).toContain(label);
		}
	});

	it("Save is disabled until a field changes and sends the whole settings", async () => {
		await act(async () => root.render(createElement(RunWorkspaceSettings)));

		const saveButton = container.querySelector(
			'[data-testid="run-workspace-save"]',
		) as HTMLButtonElement;
		expect(saveButton).not.toBeNull();
		expect(saveButton.disabled).toBe(true);

		const locationInput = container.querySelector(
			'input[aria-label="Location"]',
		) as HTMLInputElement;
		expect(locationInput).not.toBeNull();

		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(locationInput, "/custom/path");
			locationInput.dispatchEvent(new Event("input", { bubbles: true }));
			locationInput.dispatchEvent(new Event("change", { bubbles: true }));
		});

		expect(saveButton.disabled).toBe(false);

		await act(async () => {
			saveButton.click();
		});

		expect(state.updateMutate).toHaveBeenCalledTimes(1);
		expect(state.updateMutate).toHaveBeenCalledWith({
			...state.settings,
			location: "/custom/path",
		});
	});

	it("with canEdit=false inputs are disabled and Save is absent", async () => {
		state.canEdit = false;
		await act(async () => root.render(createElement(RunWorkspaceSettings)));

		const saveButton = container.querySelector(
			'[data-testid="run-workspace-save"]',
		);
		expect(saveButton).toBeNull();

		const inputs = Array.from(
			container.querySelectorAll("input, textarea, button[role='combobox']"),
		);
		expect(inputs.length).toBeGreaterThan(0);
		for (const el of inputs) {
			expect((el as HTMLInputElement).disabled).toBe(true);
		}
	});

	it('a removal row reads "Removed: you removed it." for reason removed-by-user', async () => {
		state.removals = [
			{
				runId: "run-1",
				dir: "/worktrees/pl-run-1",
				serviceId: "svc-1",
				removed: true,
				reason: "removed-by-user",
				at: "2026-10-27T10:00:00.000Z",
				teardown: null,
			},
		];

		await act(async () => root.render(createElement(RunWorkspaceSettings)));

		expect(container.textContent).toContain("/worktrees/pl-run-1");
		expect(container.textContent).toContain("Removed: you removed it.");
	});
});
