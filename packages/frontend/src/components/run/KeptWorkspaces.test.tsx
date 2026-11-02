// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { KeptWorkspace } from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeptWorkspaces } from "./KeptWorkspaces";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = {
	canEdit: true,
	workspaces: [] as KeptWorkspace[],
	openMutate: vi.fn(),
	removeMutateAsync: vi.fn(
		async (_input: {
			runId: string;
			dir: string;
		}): Promise<{ removed: boolean; reason: string }> => ({
			removed: true,
			reason: "removed-by-user",
		}),
	),
	invalidateQueries: vi.fn(),
};

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		invalidateQueries: state.invalidateQueries,
	}),
	useQuery: () => ({
		data: {
			workspaces: state.workspaces,
			canEdit: state.canEdit,
		},
	}),
	useMutation: (options: any) => {
		if (options?.onSettled) {
			// This is the remove mutation
			return {
				mutateAsync: async (input: { runId: string; dir: string }) => {
					try {
						return await state.removeMutateAsync(input);
					} finally {
						options.onSettled();
					}
				},
				isPending: false,
				error: null,
			};
		}
		// This is the open mutation
		return {
			mutate: state.openMutate,
			isPending: false,
			error: null,
		};
	},
}));

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		runWorkspaces: {
			listForRun: {
				queryOptions: () => ({ queryKey: ["runWorkspaces", "listForRun"] }),
			},
			open: {
				mutationOptions: () => ({}),
			},
			remove: {
				mutationOptions: () => ({ onSettled: vi.fn() }),
			},
			removals: {
				key: () => ["runWorkspaces", "removals"],
			},
		},
	},
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	state.canEdit = true;
	state.workspaces = [];
	state.openMutate = vi.fn();
	state.removeMutateAsync = vi.fn(async () => ({
		removed: true,
		reason: "removed-by-user",
	}));
	state.invalidateQueries = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	// Also clean any portaled dialogs from document.body
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("KeptWorkspaces", () => {
	it("renders nothing with no kept workspaces", async () => {
		state.workspaces = [];
		await act(async () =>
			root.render(createElement(KeptWorkspaces, { runId: "run-1" })),
		);

		expect(container.innerHTML).toBe("");
	});

	it("shows the dir with Open folder and Remove; Remove asks for confirmation before calling remove with {runId, dir}", async () => {
		state.workspaces = [
			{
				dir: "/worktrees/pl-run-1",
				serviceId: "svc-1",
				method: "worktree",
				keptAt: "2026-10-27T10:00:00.000Z",
				reason: "changed",
			},
		];
		await act(async () =>
			root.render(createElement(KeptWorkspaces, { runId: "run-1" })),
		);

		expect(container.textContent).toContain("/worktrees/pl-run-1");

		const buttons = Array.from(container.querySelectorAll("button"));
		const openBtn = buttons.find(
			(b) => b.textContent?.trim() === "Open folder",
		);
		const removeBtn = buttons.find((b) => b.textContent?.trim() === "Remove");

		expect(openBtn).toBeDefined();
		expect(removeBtn).toBeDefined();

		// Clicking Open folder triggers open mutation
		await act(async () => {
			openBtn?.click();
		});
		expect(state.openMutate).toHaveBeenCalledWith({
			runId: "run-1",
			dir: "/worktrees/pl-run-1",
		});

		// Remove has not been called yet
		expect(state.removeMutateAsync).not.toHaveBeenCalled();

		// Clicking Remove opens confirmation dialog
		await act(async () => {
			removeBtn?.click();
		});

		// Look for dialog confirmation in document.body (since AlertDialog portals)
		const confirmButtons = Array.from(
			document.body.querySelectorAll("button"),
		).filter((b) => b.textContent?.trim() === "Remove");
		// The confirm button in dialog
		const dialogConfirmBtn = confirmButtons[confirmButtons.length - 1];
		expect(dialogConfirmBtn).toBeDefined();

		// Confirm removal
		await act(async () => {
			dialogConfirmBtn.click();
		});

		expect(state.removeMutateAsync).toHaveBeenCalledWith({
			runId: "run-1",
			dir: "/worktrees/pl-run-1",
		});
		expect(state.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["runWorkspaces", "listForRun"],
		});
		expect(state.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["runWorkspaces", "removals"],
		});
	});

	it("a refused removal keeps the confirmation open and says why", async () => {
		state.removeMutateAsync = vi.fn(async () => ({
			removed: false,
			reason: "live",
		}));
		state.workspaces = [
			{
				dir: "/worktrees/pl-run-1",
				serviceId: "svc-1",
				method: "worktree",
				keptAt: "2026-10-27T10:00:00.000Z",
				reason: "changed",
			},
		];
		await act(async () =>
			root.render(createElement(KeptWorkspaces, { runId: "run-1" })),
		);
		const removeBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "Remove",
		);
		await act(async () => {
			removeBtn?.click();
		});
		const confirmButtons = Array.from(
			document.body.querySelectorAll("button"),
		).filter((b) => b.textContent?.trim() === "Remove");
		await act(async () => {
			confirmButtons[confirmButtons.length - 1].click();
		});

		expect(state.removeMutateAsync).toHaveBeenCalled();
		const dialog = document.body.querySelector('[role="alertdialog"]');
		expect(dialog).not.toBeNull();
		expect(dialog?.textContent).toContain(
			"Not removed: its run is still going.",
		);
	});

	it("no buttons when canEdit=false", async () => {
		state.canEdit = false;
		state.workspaces = [
			{
				dir: "/worktrees/pl-run-1",
				serviceId: "svc-1",
				method: "worktree",
				keptAt: "2026-10-27T10:00:00.000Z",
				reason: "changed",
			},
		];
		await act(async () =>
			root.render(createElement(KeptWorkspaces, { runId: "run-1" })),
		);

		expect(container.textContent).toContain("/worktrees/pl-run-1");
		const buttons = container.querySelectorAll("button");
		expect(buttons.length).toBe(0);
	});
});
