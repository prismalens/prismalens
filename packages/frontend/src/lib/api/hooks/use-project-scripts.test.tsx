// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function HookHarness<T>({
	hook,
	onResult,
}: {
	hook: () => T;
	onResult: (value: T) => void;
}) {
	onResult(hook());
	return null;
}

function renderHook<T>(hook: () => T, queryClient: QueryClient) {
	const result = { current: undefined as unknown as T };
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			<QueryClientProvider client={queryClient}>
				<HookHarness
					hook={hook}
					onResult={(value) => {
						result.current = value;
					}}
				/>
			</QueryClientProvider>,
		);
	});
	return { result, container };
}

describe("useEditProjectScript", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		vi.clearAllMocks();
	});

	it("executes addScript and invalidates threads.context and repositories.scripts queries", async () => {
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(
			() => useEditProjectScript("proj-1"),
			queryClient,
		);

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
		const { result } = renderHook(
			() => useEditProjectScript("proj-1"),
			queryClient,
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
		const { result } = renderHook(
			() => useEditProjectScript("proj-1"),
			queryClient,
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
