// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CredentialsInvalidError,
	getTemplate,
	ProviderError,
	RateLimitError,
	SignInExpired,
} from "@prismalens/integrations";
import { describe, expect, it, vi } from "vitest";
import type { SourceConnection } from "./source-request.js";
import { readStored } from "./stored-credential.js";
import {
	type TemplateConnection,
	templateRequestFn,
} from "./template-request.js";

// An oauth credential would call the real token endpoint; its kind throws the expiry instead.
vi.mock("@prismalens/integrations", async (original) => {
	const actual = await original<typeof import("@prismalens/integrations")>();
	return {
		...actual,
		credentialKind: (kind: Parameters<typeof actual.credentialKind>[0]) =>
			kind === "oauth"
				? {
						kind,
						authorize: async () => {
							throw new actual.SignInExpired();
						},
					}
				: actual.credentialKind(kind),
	};
});

interface RecordedRequest {
	url: string;
	headers: Record<string, string>;
	method: string;
	body?: unknown;
}

function fakeFetchQueue(responses: Response[]) {
	const queue = [...responses];
	const calls: RecordedRequest[] = [];
	const fetchImpl = (async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const next = queue.shift();
		if (!next) {
			throw new Error("fakeFetchQueue ran out of responses");
		}
		const headers: Record<string, string> = {};
		if (init?.headers) {
			if (init.headers instanceof Headers) {
				init.headers.forEach((v, k) => {
					headers[k] = v;
				});
			} else if (Array.isArray(init.headers)) {
				for (const [k, v] of init.headers) {
					headers[k] = v;
				}
			} else {
				Object.assign(headers, init.headers);
			}
		}
		calls.push({
			url: String(input),
			headers,
			method: init?.method ?? "GET",
			body: init?.body,
		});
		return next;
	}) as unknown as typeof fetch;
	return { calls, fetchImpl, queue };
}

function makeConnection(
	templateId: string,
	blob: Record<string, unknown>,
	fetchImpl: typeof fetch,
): TemplateConnection {
	const template = getTemplate(templateId);
	if (!template) {
		throw new Error(`Unknown template ${templateId}`);
	}
	const stored = readStored(templateId, blob);
	const connection: SourceConnection = {
		id: "conn-1",
		load: async () => {
			if (!stored.credential.ok) {
				throw new Error("No credential");
			}
			return stored.credential.credential;
		},
		save: async () => {},
	};
	return {
		connectionId: "conn-1",
		template,
		blob,
		stored,
		connection,
		fetchImpl,
	};
}

describe("templateRequestFn (#848 lane B)", () => {
	it("reports an expired sign-in on the connection and rethrows it", async () => {
		const { fetchImpl } = fakeFetchQueue([]);
		const conn = makeConnection(
			"gitlab-token",
			{
				kind: "oauth",
				authorizationUrl: "https://gitlab.com/oauth/authorize",
				tokenUrl: "https://gitlab.com/oauth/token",
				redirectUri: "http://127.0.0.1:6474/callback",
				clientId: "client",
				scopes: ["read_api"],
				refreshToken: "R0",
				baseUrl: "https://gitlab.com/api/v4",
			},
			fetchImpl,
		);
		const reported: unknown[] = [];
		conn.connection.report = async (p) => {
			reported.push(p);
		};

		await expect(templateRequestFn(async () => conn)("GET", "/user")).rejects.toBeInstanceOf(
			SignInExpired,
		);
		expect(reported).toEqual([
			{ kind: "sign-in-expired", message: expect.any(String) },
		]);
	});

	it("a GitHub bearer row sends the template's headers to its base URL", async () => {
		const { calls, fetchImpl } = fakeFetchQueue([
			new Response(JSON.stringify({ login: "octocat" }), { status: 200 }),
		]);
		const conn = makeConnection(
			"github-token",
			{ apiKey: "ghp_x", baseUrl: "https://api.github.com" },
			fetchImpl,
		);
		const request = templateRequestFn(async () => conn);

		const res = await request("GET", "/user");
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.github.com/user");
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.headers).toMatchObject({
			Authorization: "Bearer ghp_x",
			Accept: "application/vnd.github.v3+json",
			"X-GitHub-Api-Version": "2022-11-28",
		});
	});

	it("a Render row with no kind sends its token and Accept header", async () => {
		const { calls, fetchImpl } = fakeFetchQueue([
			new Response(JSON.stringify([]), { status: 200 }),
		]);
		const conn = makeConnection("render", { apiKey: "rnd_x" }, fetchImpl);
		const request = templateRequestFn(async () => conn);

		const res = await request("GET", "/v1/owners");
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.render.com/v1/owners");
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.headers).toMatchObject({
			Authorization: "Bearer rnd_x",
			Accept: "application/json",
		});
	});

	it("A 401 on a bearer row is sent once only and throws CredentialsInvalidError", async () => {
		const { calls, fetchImpl } = fakeFetchQueue([
			new Response(JSON.stringify({ message: "Bad credentials" }), {
				status: 401,
			}),
		]);
		const conn = makeConnection(
			"github-token",
			{ apiKey: "ghp_x", baseUrl: "https://api.github.com" },
			fetchImpl,
		);
		const request = templateRequestFn(async () => conn);

		await expect(request("GET", "/user")).rejects.toBeInstanceOf(
			CredentialsInvalidError,
		);
		expect(calls).toHaveLength(1);
	});

	it("A 429 with retry-after: 7 throws RateLimitError whose retryAfter is 7", async () => {
		const { calls, fetchImpl } = fakeFetchQueue([
			new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
				status: 429,
				headers: { "retry-after": "7" },
			}),
		]);
		const conn = makeConnection(
			"github-token",
			{ apiKey: "ghp_x", baseUrl: "https://api.github.com" },
			fetchImpl,
		);
		const request = templateRequestFn(async () => conn);

		const err = await request("GET", "/user").catch((e) => e);
		expect(err).toBeInstanceOf(RateLimitError);
		expect((err as RateLimitError).retryAfter).toBe(7);
		expect(calls).toHaveLength(1);
	});

	it("A 500 throws ProviderError with httpStatus 500", async () => {
		const { calls, fetchImpl } = fakeFetchQueue([
			new Response(JSON.stringify({ message: "Internal server error" }), {
				status: 500,
			}),
		]);
		const conn = makeConnection(
			"github-token",
			{ apiKey: "ghp_x", baseUrl: "https://api.github.com" },
			fetchImpl,
		);
		const request = templateRequestFn(async () => conn);

		const err = await request("GET", "/user").catch((e) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect((err as ProviderError).httpStatus).toBe(500);
		expect(calls).toHaveLength(1);
	});

	it("Caller headers in options.headers override template headers", async () => {
		const { calls, fetchImpl } = fakeFetchQueue([
			new Response(JSON.stringify({}), { status: 200 }),
		]);
		const conn = makeConnection(
			"github-token",
			{ apiKey: "ghp_x", baseUrl: "https://api.github.com" },
			fetchImpl,
		);
		const request = templateRequestFn(async () => conn);

		const res = await request("GET", "/user", {
			headers: {
				Accept: "application/vnd.github.raw+json",
				Authorization: "Bearer overridden-token",
			},
		});
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.headers.Accept).toBe("application/vnd.github.raw+json");
		expect(calls[0]?.headers.Authorization).toBe("Bearer overridden-token");
		expect(calls[0]?.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
	});
});
