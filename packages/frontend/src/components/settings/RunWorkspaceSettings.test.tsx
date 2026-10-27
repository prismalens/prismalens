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
	copies: undefined as
		| { location: string | null; defaultLocation: string; previous: string[] }
		| undefined,
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
				copies: state.copies,
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
			updateCopies: {
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
	state.copies = undefined;
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

describe("RunWorkspaceSettings, Git URLs (#925)", () => {
	it("shows where URLs are cloned once and saves a new folder", async () => {
		state.copies = {
			location: null,
			defaultLocation: "/data/repos",
			previous: [],
		};
		await act(async () => root.render(createElement(RunWorkspaceSettings)));

		const input = container.querySelector(
			'input[aria-label="Cloned copies"]',
		) as HTMLInputElement;
		expect(input.placeholder).toBe("/data/repos");
		const save = container.querySelector(
			'[data-testid="run-workspace-copies-save"]',
		) as HTMLButtonElement;
		expect(save.disabled).toBe(true);

		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "/fast/disk");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => save.click());
		expect(state.updateMutate).toHaveBeenCalledWith({ location: "/fast/disk" });
	});

	it("names the old folders still in use, and a paired device cannot save", async () => {
		state.canEdit = false;
		state.copies = {
			location: "/fast/disk",
			defaultLocation: "/data/repos",
			previous: ["/data/repos"],
		};
		await act(async () => root.render(createElement(RunWorkspaceSettings)));

		expect(container.textContent).toContain("Copies still in /data/repos");
		expect(
			container.querySelector('[data-testid="run-workspace-copies-save"]'),
		).toBeNull();
	});
});
