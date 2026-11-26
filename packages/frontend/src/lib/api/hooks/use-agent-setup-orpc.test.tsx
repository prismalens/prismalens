// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHookWithApp } from "@/test/render";
import { useRemoveSharedServer, useSharedSet } from "./use-agent-setup-orpc";

const read = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());

vi.mock("../orpc-client", () => ({
	orpc: {
		settings: {
			agentSetup: {
				key: () => ["agentSetup"],
				sharedSet: {
					queryKey: () => ["agentSetup", "sharedSet"],
					queryOptions: () => ({
						queryKey: ["agentSetup", "sharedSet"],
						queryFn: read,
					}),
				},
				loadout: { key: () => ["agentSetup", "loadout"] },
				removeSharedServer: { mutationOptions: () => ({ mutationFn: remove }) },
			},
		},
	},
}));

const set = (...names: string[]) => ({
	decided: "shared",
	instructions: "",
	instructionsFor: [],
	revision: "r",
	servers: names.map((name) => ({ name })),
});

describe("the PrismaLens set hooks (#1180 §3.3)", () => {
	it("a set read already under way when a removal lands never brings the removed server back", async () => {
		read.mockResolvedValueOnce(set("docs", "web"));
		let stale!: () => void;
		read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					stale = () => resolve(set("docs", "web"));
				}),
		);
		read.mockResolvedValue(set("web"));
		remove.mockResolvedValueOnce(set("web"));
		const hook = await renderHookWithApp(() => ({
			set: useSharedSet(),
			remove: useRemoveSharedServer(),
		}));
		await vi.waitFor(() => {
			if (!hook.result.current.set.data) throw new Error("not read");
		});
		await act(async () => {
			void hook.result.current.set.refetch();
		});
		await act(async () => {
			await hook.result.current.remove.mutateAsync({ name: "docs" });
		});
		await act(async () => stale());
		await act(() => new Promise((r) => setTimeout(r, 20)));
		expect(hook.result.current.set.data?.servers.map((s) => s.name)).toEqual([
			"web",
		]);
		await hook.unmount();
	});
});
