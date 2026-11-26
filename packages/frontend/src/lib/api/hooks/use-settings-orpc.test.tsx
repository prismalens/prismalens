// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHookWithApp } from "@/test/render";
import {
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "./use-settings-orpc";

const read = vi.hoisted(() => vi.fn());

vi.mock("../orpc-client", () => ({
	orpc: {
		settings: {
			harnesses: {
				getSettings: {
					key: () => ["harness", "settings"],
					queryOptions: () => ({
						queryKey: ["harness", "settings"],
						queryFn: read,
					}),
				},
				getHarnesses: { key: () => ["harness", "status"] },
				updateSettings: {
					mutationOptions: () => ({ mutationFn: async () => ({}) }),
				},
			},
		},
	},
}));

describe("useUpdateHarnessSettings (#1180)", () => {
	it("stays pending until the settings it saved have been read back", async () => {
		read.mockResolvedValueOnce({ favourites: [] });
		let readBack!: () => void;
		read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					readBack = () => resolve({ favourites: ["saved"] });
				}),
		);
		const hook = await renderHookWithApp(() => ({
			settings: useHarnessSettings(),
			update: useUpdateHarnessSettings(),
		}));
		await vi.waitFor(() => {
			if (!hook.result.current.settings.data) throw new Error("not read");
		});
		await act(async () => {
			hook.result.current.update.mutate({ favourites: [] });
		});
		await vi.waitFor(() => {
			if (read.mock.calls.length < 2) throw new Error("not reading back");
		});
		// The query client tells its observers on a later task.
		await act(() => new Promise((r) => setTimeout(r, 20)));
		expect(hook.result.current.update.isPending).toBe(true);
		await act(async () => readBack());
		await vi.waitFor(() => {
			if (hook.result.current.update.isPending) throw new Error("pending");
		});
		expect(hook.result.current.settings.data).toEqual({
			favourites: ["saved"],
		});
		await hook.unmount();
	});
});
