// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	useUpdateThreadContextSettings,
	useUpdateTreeSettings,
} from "./use-app-settings-orpc";

const { updateThreadContextSpy, updateTreeSettingsSpy } = vi.hoisted(() => ({
	updateThreadContextSpy: vi
		.fn()
		.mockImplementation((input) => Promise.resolve(input)),
	updateTreeSettingsSpy: vi
		.fn()
		.mockImplementation((input) => Promise.resolve(input)),
}));

vi.mock("../orpc-client", () => ({
	orpc: {
		settings: {
			threadContext: {
				get: {
					queryKey: () => ["settings", "threadContext"],
				},
				update: {
					call: updateThreadContextSpy,
				},
			},
		},
		threadTree: {
			getSettings: {
				queryKey: () => ["threadTree", "settings"],
			},
			updateSettings: {
				call: updateTreeSettingsSpy,
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
	return {
		result,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

beforeEach(() => {
	updateThreadContextSpy.mockClear();
	updateTreeSettingsSpy.mockClear();
});

describe("use-app-settings-orpc", () => {
	it("sends merged cached editor on thread context update and defaults to system when uncached", async () => {
		const cachedClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		cachedClient.setQueryData(["settings", "threadContext"], {
			prStatus: true,
			editor: "vscode",
		});

		const cachedHook = renderHook(
			() => useUpdateThreadContextSettings(),
			cachedClient,
		);
		await act(async () => {
			cachedHook.result.current.mutate({ prStatus: false });
		});
		expect(updateThreadContextSpy).toHaveBeenCalledWith({
			prStatus: false,
			editor: "vscode",
		});
		cachedHook.unmount();

		const emptyClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const emptyHook = renderHook(
			() => useUpdateThreadContextSettings(),
			emptyClient,
		);
		await act(async () => {
			emptyHook.result.current.mutate({ prStatus: false });
		});
		expect(updateThreadContextSpy).toHaveBeenCalledWith({
			prStatus: false,
			editor: "system",
		});
		emptyHook.unmount();
	});

	// ce798d662 adds turnsPerDay to tree settings defaults.
	it("runs two quick tree-settings changes in order, the second on top of the first", async () => {
		let releaseFirst!: () => void;
		updateTreeSettingsSpy.mockImplementationOnce(
			(input) =>
				new Promise((resolve) => {
					releaseFirst = () => resolve(input);
				}),
		);
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const hook = renderHook(() => useUpdateTreeSettings(), queryClient);
		const second = renderHook(() => useUpdateTreeSettings(), queryClient);
		await act(async () => {
			hook.result.current.mutate({ agentsStartThreads: "allow" });
			second.result.current.mutate({ depth: 3 });
		});
		expect(updateTreeSettingsSpy).toHaveBeenCalledTimes(1);
		await act(async () => {
			releaseFirst();
		});
		expect(updateTreeSettingsSpy).toHaveBeenCalledTimes(2);
		expect(updateTreeSettingsSpy).toHaveBeenLastCalledWith({
			agentsStartThreads: "allow",
			depth: 3,
			children: 4,
			perTree: 10,
			turnsPerDay: 200,
		});
		hook.unmount();
		second.unmount();
	});

	// ce798d662 adds turnsPerDay to tree settings defaults.
	it("sends defaults with patched depth on tree settings update when uncached", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const hook = renderHook(() => useUpdateTreeSettings(), queryClient);
		await act(async () => {
			hook.result.current.mutate({ depth: 3 });
		});
		expect(updateTreeSettingsSpy).toHaveBeenCalledWith({
			agentsStartThreads: "ask",
			depth: 3,
			children: 4,
			perTree: 10,
			turnsPerDay: 200,
		});
		hook.unmount();
	});
});
