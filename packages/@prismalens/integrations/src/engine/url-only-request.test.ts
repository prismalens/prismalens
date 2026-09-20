// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { urlOnlyRequestFn } from "./url-only-request.js";

describe("urlOnlyRequestFn (#633)", () => {
	it("joins path onto base with or without trailing slash", async () => {
		const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
			return new Response("ok", { status: 200 });
		});

		// Without trailing slash
		const req1 = urlOnlyRequestFn("http://127.0.0.1:9090", fetchMock as unknown as typeof fetch);
		await req1("GET", "/-/ready");
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://127.0.0.1:9090/-/ready",
			expect.objectContaining({ method: "GET" }),
		);

		// With trailing slash
		const req2 = urlOnlyRequestFn("http://127.0.0.1:9090/", fetchMock as unknown as typeof fetch);
		await req2("GET", "/-/ready");
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://127.0.0.1:9090/-/ready",
			expect.objectContaining({ method: "GET" }),
		);

		// Relative path without leading slash
		const req3 = urlOnlyRequestFn("http://127.0.0.1:9090", fetchMock as unknown as typeof fetch);
		await req3("GET", "-/ready");
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://127.0.0.1:9090/-/ready",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("passes a 10s AbortSignal timeout and options", async () => {
		let capturedSignal: AbortSignal | null | undefined;
		let capturedHeaders: Record<string, string> | undefined;
		let capturedBody: string | undefined;

		const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			capturedSignal = init?.signal;
			capturedHeaders = init?.headers as Record<string, string>;
			capturedBody = init?.body as string;
			return new Response("ok", { status: 200 });
		});

		const req = urlOnlyRequestFn("http://prometheus.internal:9090", fetchMock as unknown as typeof fetch);
		await req("POST", "/api/v1/query", {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "query=up",
		});

		expect(capturedSignal).toBeDefined();
		expect(capturedSignal?.aborted).toBe(false);
		expect(capturedHeaders).toEqual({
			"Content-Type": "application/x-www-form-urlencoded",
		});
		expect(capturedBody).toBe("query=up");
	});
});
