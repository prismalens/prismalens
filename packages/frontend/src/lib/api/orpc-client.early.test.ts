// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyChange, forgetStreamCursor } from "./live-stream";
import { orpc } from "./orpc-client";
import { LIVE_CURSOR_HEADER } from "./read-cursor";

type EarlyWindow = Window & {
	__plEarly?: { at: number; res: Record<string, Promise<Response>> } | null;
};
const win = window as EarlyWindow;

const answer = (cursor: string, from: string) =>
	new Response(JSON.stringify({ id: "x", from }), {
		headers: { "content-type": "application/json", [LIVE_CURSOR_HEADER]: cursor },
	});

const fetchMock = vi.fn(async () => answer("ep1.30", "network"));

/** The path the client asks for this read: the HTML's early response is keyed by it. */
async function pathOf(): Promise<string> {
	await new QueryClient().fetchQuery(
		orpc.investigations.get.queryOptions({ input: { id: "x" } }),
	);
	const [input] = fetchMock.mock.calls.at(-1) as unknown as [RequestInfo | URL];
	const url = new URL(input instanceof Request ? input.url : String(input));
	fetchMock.mockClear();
	return url.pathname + url.search;
}

async function readThrough(qc: QueryClient) {
	const observer = new QueryObserver(
		qc,
		orpc.investigations.get.queryOptions({ input: { id: "x" } }),
	);
	const stop = observer.subscribe(() => {});
	await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
	await new Promise((r) => setTimeout(r, 20));
	stop();
	return observer.getCurrentResult().data as unknown as { from: string };
}

beforeEach(() => {
	forgetStreamCursor();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	win.__plEarly = null;
	fetchMock.mockClear();
});

describe("the HTML's early response and the change stream (#1181)", () => {
	it("a query begun after the join that takes an early answer from before it reads again, once", async () => {
		const path = await pathOf();
		const qc = new QueryClient();
		applyChange(qc, { cursor: "ep1.10", topics: ["incidents"] });
		win.__plEarly = {
			at: Date.now(),
			res: { [path]: Promise.resolve(answer("ep1.4", "early")) },
		};

		const data = await readThrough(qc);

		expect(data.from).toBe("network");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("an early answer from after the join is used as is, with no fetch", async () => {
		const path = await pathOf();
		const qc = new QueryClient();
		applyChange(qc, { cursor: "ep1.10", topics: ["incidents"] });
		win.__plEarly = {
			at: Date.now(),
			res: { [path]: Promise.resolve(answer("ep1.10", "early")) },
		};

		const data = await readThrough(qc);

		expect(data.from).toBe("early");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
