// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { orpc } from "@/lib/api/orpc-client";
import { renderHookWithApp } from "@/test/render";
import { useRewindCalls } from "./use-rewind";

const ID = "11111111-1111-1111-1111-111111111111";
const REWIND = "33333333-3333-3333-3333-333333333333";
const OP = "22222222-2222-2222-2222-222222222222";

async function changesAfter(call: "undo" | "restore") {
	let changes = { repos: [{ repo: "app", files: ["src/a.ts"] }] };
	const { result } = await renderHookWithApp(
		() => ({
			calls: useRewindCalls(ID),
			changes: useQuery(
				orpc.investigations.getChanges.queryOptions({ input: { id: ID } }),
			),
		}),
		{
			api: {
				"investigations.getChanges": () => changes,
				"threads.rewindUndo": { state: "done", restored: [], kept: [] },
				"threads.rewindRestore": { state: "done", restored: [], kept: [] },
			},
		},
	);
	await vi.waitFor(() =>
		expect(result.current.changes.data).toEqual({
			repos: [{ repo: "app", files: ["src/a.ts"] }],
		}),
	);
	changes = { repos: [{ repo: "app", files: [] }] };
	await act(async () => {
		if (call === "undo")
			await result.current.calls.undo.mutateAsync({ id: ID, rewindId: REWIND });
		else
			await result.current.calls.restore.mutateAsync({
				id: ID,
				op: OP,
				expect: { head: "h1", tree: "t1" },
				include: [],
			});
	});
	return result;
}

describe("useRewindCalls refreshes the Changes tree (#1193)", () => {
	it("after an Undo, the open Changes query shows the files as they are now", async () => {
		const result = await changesAfter("undo");
		await vi.waitFor(() =>
			expect(result.current.changes.data).toEqual({
				repos: [{ repo: "app", files: [] }],
			}),
		);
	});

	it("after a Restore, the open Changes query shows the files as they are now", async () => {
		const result = await changesAfter("restore");
		await vi.waitFor(() =>
			expect(result.current.changes.data).toEqual({
				repos: [{ repo: "app", files: [] }],
			}),
		);
	});
});
