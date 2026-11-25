// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithApp } from "@/test/render";
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

beforeEach(() => {
	updateThreadContextSpy.mockClear();
	updateTreeSettingsSpy.mockClear();
});

describe("use-app-settings-orpc", () => {
	it("sends merged cached editor on thread context update and defaults to system when uncached", async () => {
		const cachedHook = await renderHookWithApp(() =>
			useUpdateThreadContextSettings(),
		);
		cachedHook.queryClient.setQueryData(["settings", "threadContext"], {
			prStatus: true,
			editor: "vscode",
		});
		await act(async () => {
			cachedHook.result.current.mutate({ prStatus: false });
		});
		expect(updateThreadContextSpy).toHaveBeenCalledWith({
			prStatus: false,
			editor: "vscode",
			rerunChecks: false,
		});
		await cachedHook.unmount();

		const emptyHook = await renderHookWithApp(() =>
			useUpdateThreadContextSettings(),
		);
		await act(async () => {
			emptyHook.result.current.mutate({ prStatus: false });
		});
		expect(updateThreadContextSpy).toHaveBeenCalledWith({
			prStatus: false,
			editor: "system",
			rerunChecks: false,
		});
		await emptyHook.unmount();
	});

	// ce798d662 adds turnsPerDay to tree settings defaults; e1858b496 adds pairPerDay.
	it("runs two quick tree-settings changes in order, the second on top of the first", async () => {
		let releaseFirst!: () => void;
		updateTreeSettingsSpy.mockImplementationOnce(
			(input) =>
				new Promise((resolve) => {
					releaseFirst = () => resolve(input);
				}),
		);
		const hook = await renderHookWithApp(() => useUpdateTreeSettings());
		const second = await renderHookWithApp(() => useUpdateTreeSettings(), {
			queryClient: hook.queryClient,
		});
		await act(async () => {
			hook.result.current.mutate({ agentsStartThreads: "allow" });
			second.result.current.mutate({ children: 3 });
		});
		expect(updateTreeSettingsSpy).toHaveBeenCalledTimes(1);
		await act(async () => {
			releaseFirst();
		});
		expect(updateTreeSettingsSpy).toHaveBeenCalledTimes(2);
		expect(updateTreeSettingsSpy).toHaveBeenLastCalledWith({
			agentsStartThreads: "allow",
			children: 3,
			perTree: 10,
			turnsPerDay: 200,
			pairPerDay: 20,
		});
		await hook.unmount();
		await second.unmount();
	});

	// ce798d662 adds turnsPerDay to tree settings defaults; e1858b496 adds pairPerDay.
	it("sends defaults with a patched cap on tree settings update when uncached", async () => {
		const hook = await renderHookWithApp(() => useUpdateTreeSettings());
		await act(async () => {
			hook.result.current.mutate({ children: 3 });
		});
		expect(updateTreeSettingsSpy).toHaveBeenCalledWith({
			agentsStartThreads: "ask",
			children: 3,
			perTree: 10,
			turnsPerDay: 200,
			pairPerDay: 20,
		});
		await hook.unmount();
	});
});
