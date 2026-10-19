// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { sendDeploy } from "./deploy.js";

const base = {
	server: "http://localhost:6473/",
	secret: "s3cret",
	service: "checkout",
	version: "v1",
};

describe("sendDeploy (#854)", () => {
	it("posts the deploy with the webhook secret as a bearer token", async () => {
		const doFetch = vi.fn(async () =>
			Response.json({ id: "x", created: true }),
		);
		const result = await sendDeploy(
			{ ...base, environment: "staging" },
			doFetch as unknown as typeof fetch,
		);
		expect(result).toEqual({ created: true });
		const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("http://localhost:6473/api/webhooks/deploy");
		expect((init.headers as Record<string, string>).authorization).toBe(
			"Bearer s3cret",
		);
		expect(JSON.parse(String(init.body))).toMatchObject({
			service: "checkout",
			version: "v1",
			environment: "staging",
		});
	});

	it("reports a repeat as already recorded", async () => {
		const doFetch = async () => Response.json({ id: "x", created: false });
		expect(await sendDeploy(base, doFetch as unknown as typeof fetch)).toEqual({
			created: false,
		});
	});

	it("names a refused secret", async () => {
		const doFetch = async () => new Response("{}", { status: 403 });
		const result = await sendDeploy(base, doFetch as unknown as typeof fetch);
		expect(result).toMatchObject({ error: expect.stringMatching(/refused the secret/) });
	});

	it("rejects an unknown status before any request", async () => {
		const doFetch = vi.fn();
		const result = await sendDeploy(
			{ ...base, status: "done" },
			doFetch as unknown as typeof fetch,
		);
		expect(result).toMatchObject({ error: expect.stringMatching(/--status/) });
		expect(doFetch).not.toHaveBeenCalled();
	});
});
