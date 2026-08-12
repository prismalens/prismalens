// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * #347 F1 — the shared "a provider said no" error, and the three provider
 * clients wired to it.
 *
 * Every one of these call sites used to interpolate the full non-2xx response
 * body into the thrown message. Provider error bodies echo what was sent
 * (tokens, authorization codes, client credentials) and these errors are
 * logged, so the body is now never read and never rendered. These tests fail
 * against the pre-fix code.
 */
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { GitHubProvider } from "../providers/github/github.provider.js";
import { RenderProvider } from "../providers/render/render.provider.js";
import type { AuthenticatedRequestFn } from "../providers/types.js";
import { VercelProvider } from "../providers/vercel/vercel.provider.js";
import {
	httpStatusDiagnostic,
	providerHttpError,
	providerJsonParseError,
} from "./provider-http-error.js";

const SENTINEL = "sk-SENTINEL-DO-NOT-LOG";

/** Every string a logger or crash reporter could pull out of a thrown error. */
function errorSurfaces(error: unknown): Record<string, string> {
	const err = error as Error;
	return {
		message: err.message,
		string: String(err),
		stack: err.stack ?? "",
		json: JSON.stringify(err),
		jsonAllProps: JSON.stringify(err, Object.getOwnPropertyNames(err)),
		inspect: inspect(err, { depth: null }),
	};
}

function expectNoSentinel(error: unknown): Error {
	for (const [surface, text] of Object.entries(errorSurfaces(error))) {
		expect(text, `sentinel leaked via error ${surface}`).not.toContain(SENTINEL);
		expect(text, `sentinel fragment leaked via error ${surface}`).not.toMatch(
			/SENTINEL/i,
		);
	}
	return error as Error;
}

describe("httpStatusDiagnostic", () => {
	it("renders the registered reason phrase for a known status", () => {
		expect(httpStatusDiagnostic(400)).toBe("HTTP 400 Bad Request");
		expect(httpStatusDiagnostic(429)).toBe("HTTP 429 Too Many Requests");
	});

	it("renders the bare status for a code with no registered phrase", () => {
		expect(httpStatusDiagnostic(499)).toBe("HTTP 499");
	});
});

describe("providerHttpError", () => {
	it("names the operation, the provider and the HTTP status", () => {
		const error = providerHttpError({
			operation: "OAuth token exchange",
			provider: "acme",
			response: { status: 403 },
		});

		expect(error.message).toBe(
			"OAuth token exchange failed for provider 'acme' (HTTP 403 Forbidden)",
		);
	});

	it("ignores everything on the response except the status code", () => {
		// A Response object carrying a secret in body, reason phrase and headers.
		const response = new Response(SENTINEL, {
			status: 401,
			statusText: SENTINEL,
			headers: { "x-leak": SENTINEL },
		});

		const error = expectNoSentinel(
			providerHttpError({
				operation: "Widget API request",
				provider: "widget",
				response,
			}),
		);

		expect(error.message).toBe(
			"Widget API request failed for provider 'widget' (HTTP 401 Unauthorized)",
		);
		expect(response.bodyUsed).toBe(false);
	});
});

describe("providerJsonParseError", () => {
	it("names the operation, the provider and the status", () => {
		expect(
			providerJsonParseError({
				operation: "OAuth token exchange",
				provider: "acme",
				response: { status: 200 },
			}).message,
		).toBe(
			"OAuth token exchange failed for provider 'acme': provider returned a 200 response that is not valid JSON",
		);
	});

	it("drops the provider clause where the operation already names it", () => {
		expect(
			providerJsonParseError({
				operation: "GitHub get installation",
				response: { status: 502 },
			}).message,
		).toBe(
			"GitHub get installation failed: provider returned a 502 response that is not valid JSON",
		);
	});

	it("carries none of the leading body fragment a real SyntaxError quotes", () => {
		// V8 quotes the first 10 characters of the offending input, so a body that
		// *starts* with the credential discloses its prefix. Bounded, not whole-body
		// — but the refresh path persists this error, so it still must not travel.
		const body = `${SENTINEL} is not json`;
		const leaked = SENTINEL.slice(0, 10);
		const raw = ((): Error => {
			try {
				JSON.parse(body);
				throw new Error("expected a parse failure");
			} catch (e) {
				return e as Error;
			}
		})();
		expect(raw.message).toContain(leaked);

		const error = providerJsonParseError({
			operation: "Token refresh",
			provider: "acme",
			response: { status: 200 },
		});
		for (const [surface, text] of Object.entries(errorSurfaces(error))) {
			expect(text, `body fragment leaked via error ${surface}`).not.toContain(
				leaked,
			);
		}
	});
});

/**
 * A stub for the bound authenticated request function the providers are given.
 * Providers never see raw tokens, so the only thing under test here is what
 * they do with a non-2xx `Response`.
 */
function failingRequest(status: number, body: string): AuthenticatedRequestFn {
	return vi.fn(async () => new Response(body, { status }));
}

describe("provider clients do not leak the response body (#347 F1)", () => {
	it("GitHubProvider", async () => {
		const request = failingRequest(
			422,
			JSON.stringify({ message: `bad token ${SENTINEL}` }),
		);

		const error = expectNoSentinel(
			await new GitHubProvider()
				.getOrganizations(request)
				.then(() => {
					throw new Error("expected getOrganizations to reject");
				})
				.catch((e: unknown) => e),
		);

		expect(error.message).toBe(
			"GitHub API request failed for provider 'github' (HTTP 422 Unprocessable Entity)",
		);
	});

	it("VercelProvider", async () => {
		const request = failingRequest(
			403,
			JSON.stringify({ error: { message: `token ${SENTINEL}` } }),
		);

		const error = expectNoSentinel(
			await new VercelProvider()
				.listServices(request)
				.then(() => {
					throw new Error("expected listServices to reject");
				})
				.catch((e: unknown) => e),
		);

		expect(error.message).toBe(
			"Vercel API request failed for provider 'vercel' (HTTP 403 Forbidden)",
		);
	});

	it("RenderProvider", async () => {
		const request = failingRequest(500, `internal error: ${SENTINEL}`);

		const error = expectNoSentinel(
			await new RenderProvider()
				.listServices(request)
				.then(() => {
					throw new Error("expected listServices to reject");
				})
				.catch((e: unknown) => e),
		);

		expect(error.message).toBe(
			"Render API request failed for provider 'render' (HTTP 500 Internal Server Error)",
		);
	});
});
