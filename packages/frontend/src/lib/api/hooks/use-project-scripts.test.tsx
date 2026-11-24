// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithApp } from "@/test/render";
import { useEditProjectScript } from "./use-project-scripts";

const { addScriptSpy, updateScriptSpy, removeScriptSpy } = vi.hoisted(() => ({
	addScriptSpy: vi.fn().mockImplementation((input) => Promise.resolve(input)),
	updateScriptSpy: vi
		.fn()
		.mockImplementation((input) => Promise.resolve(input)),
	removeScriptSpy: vi
		.fn()
		.mockImplementation((input) => Promise.resolve(input)),
}));

vi.mock("../orpc-client", () => ({
	orpc: {
		repositories: {
			addScript: {
				call: addScriptSpy,
			},
			updateScript: {
				call: updateScriptSpy,
			},
			removeScript: {
				call: removeScriptSpy,
			},
			scripts: {
				key: () => ["repositories", "scripts"],
			},
		},
		threads: {
			context: {
				key: () => ["threads", "context"],
			},
		},
	},
}));

describe("useEditProjectScript", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("executes addScript and invalidates threads.context and repositories.scripts queries", async () => {
		const { result, queryClient } = await renderHookWithApp(() =>
			useEditProjectScript("proj-1"),
		);
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		await act(async () => {
			await result.current.mutateAsync({
				op: "add",
				name: "dev",
				command: "pnpm dev",
			});
		});

		expect(addScriptSpy).toHaveBeenCalledWith({
			id: "proj-1",
			name: "dev",
			command: "pnpm dev",
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["threads", "context"],
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["repositories", "scripts"],
		});
	});

	it("executes updateScript", async () => {
		const { result } = await renderHookWithApp(() =>
			useEditProjectScript("proj-1"),
		);

		await act(async () => {
			await result.current.mutateAsync({
				op: "update",
				scriptId: "s-1",
				name: "build",
				command: "pnpm build",
			});
		});

		expect(updateScriptSpy).toHaveBeenCalledWith({
			id: "proj-1",
			scriptId: "s-1",
			name: "build",
			command: "pnpm build",
		});
	});

	it("executes removeScript", async () => {
		const { result } = await renderHookWithApp(() =>
			useEditProjectScript("proj-1"),
		);

		await act(async () => {
			await result.current.mutateAsync({
				op: "remove",
				scriptId: "s-1",
			});
		});

		expect(removeScriptSpy).toHaveBeenCalledWith({
			id: "proj-1",
			scriptId: "s-1",
		});
	});
});
