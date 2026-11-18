// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { applyChange } from "./live-stream";
import { orpc } from "./orpc-client";
import { noteReadCursor } from "./read-cursor";

/** A list read whose response carries `cursor`, answered when the test says. */
function heldRead(qc: QueryClient, id: string, cursor: string) {
	let answer!: () => void;
	const gate = new Promise<void>((r) => {
		answer = r;
	});
	let calls = 0;
	const queryFn = vi.fn(async () => {
		calls++;
		if (calls === 1) {
			await gate;
			noteReadCursor(cursor);
		}
		return [{ id, calls }];
	});
	const observer = new QueryObserver(qc, {
		queryKey: orpc.investigations.get.key({ input: { id } }),
		queryFn,
	});
	const stop = observer.subscribe(() => {});
	const settled = () => observer.getCurrentResult().isSuccess;
	return { answer, queryFn, settled, stop };
}

describe("reads answered from before the page joined the stream (#1181)", () => {
	it("each read answered from before the join re-reads once; reads before the join or from after it do not", async () => {
		const qc = new QueryClient();
		const early = heldRead(qc, "early", "ep1.3");
		early.answer();
		await vi.waitFor(() => expect(early.settled()).toBe(true));

		const first = heldRead(qc, "first", "ep1.4");
		const second = heldRead(qc, "second", "ep1.5");
		applyChange(qc, { cursor: "ep1.10", topics: ["incidents"] });

		first.answer();
		await vi.waitFor(() => expect(first.queryFn).toHaveBeenCalledTimes(2));
		second.answer();
		await vi.waitFor(() => expect(second.queryFn).toHaveBeenCalledTimes(2));
		const fresh = heldRead(qc, "fresh", "ep1.10");
		fresh.answer();
		await new Promise((r) => setTimeout(r, 20));

		expect(fresh.queryFn).toHaveBeenCalledTimes(1);
		expect(early.queryFn).toHaveBeenCalledTimes(1);
		expect(second.queryFn).toHaveBeenCalledTimes(2);
		for (const r of [early, first, second, fresh]) r.stop();
	});
});
