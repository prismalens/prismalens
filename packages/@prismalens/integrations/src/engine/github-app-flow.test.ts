// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * GitHub App auth flow (#253): RS256 JWT minting and the installation-token
 * exchange. The package is MINT-ONLY — GitHub is the relying party, so there is
 * no verify() to attack directly. These tests therefore verify the minted token
 * with node:crypto (standing in for GitHub) and assert the header pins RS256, a
 * real RSA-SHA256 signature covers the exact signing input, and forged variants
 * (wrong key, tampered payload, alg:none, HS256 substitution) do not verify.
 * Hermetic — fetch is stubbed, no network.
 */
import {
	createHmac,
	createVerify,
	generateKeyPairSync,
	type KeyObject,
} from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubAppFlow } from "./github-app-flow.js";

const APP_ID = "123456";

const keyPair = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const otherKeyPair = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

interface DecodedJwt {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
	signature: string;
	signingInput: string;
}

function decode(jwt: string): DecodedJwt {
	const [headerB64, payloadB64, signature] = jwt.split(".");
	return {
		header: JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")),
		payload: JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")),
		signature,
		signingInput: `${headerB64}.${payloadB64}`,
	};
}

/** RS256 verification, as a relying party (GitHub) would do it. */
function verifyRS256(
	jwt: string,
	publicKey: string | KeyObject = keyPair.publicKey,
): boolean {
	const { signingInput, signature } = decode(jwt);
	const verifier = createVerify("RSA-SHA256");
	verifier.update(signingInput);
	return verifier.verify(publicKey, Buffer.from(signature, "base64url"));
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("GitHubAppFlow.generateJWT — minting", () => {
	it("mints a three-part JWT whose RS256 signature verifies (the #253 falsifier)", () => {
		const jwt = GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey);

		expect(jwt.split(".")).toHaveLength(3);
		expect(verifyRS256(jwt)).toBe(true);
	});

	it("pins the algorithm to RS256 in the header", () => {
		const { header } = decode(GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey));
		expect(header).toEqual({ alg: "RS256", typ: "JWT" });
		expect(header.alg).not.toBe("none");
	});

	it("sets iss to the app id, backdates iat by 60s and expires 10 minutes out", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			const now = Math.floor(Date.now() / 1000);
			const { payload } = decode(
				GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey),
			);

			expect(payload.iss).toBe(APP_ID);
			// 60s clock-drift buffer behind, 600s ahead — GitHub caps the window at 10 min.
			expect(payload.iat).toBe(now - 60);
			expect(payload.exp).toBe(now + 600);
		} finally {
			vi.useRealTimers();
		}
	});

	it("produces a fresh token per call (iat/exp track the clock)", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			const first = decode(GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey));
			vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
			const second = decode(GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey));

			expect((second.payload.iat as number) - (first.payload.iat as number)).toBe(
				300,
			);
			expect(second.signature).not.toBe(first.signature);
		} finally {
			vi.useRealTimers();
		}
	});

	it("throws on a malformed private key rather than emitting an unsigned token", () => {
		expect(() => GitHubAppFlow.generateJWT(APP_ID, "not-a-pem-key")).toThrow();
		expect(() => GitHubAppFlow.generateJWT(APP_ID, "")).toThrow();
	});
});

describe("GitHubAppFlow.generateJWT — forged variants do not verify", () => {
	it("rejects a token signed with a different private key", () => {
		const forged = GitHubAppFlow.generateJWT(APP_ID, otherKeyPair.privateKey);
		expect(verifyRS256(forged, keyPair.publicKey)).toBe(false);
		// Sanity: it does verify under its own key, so the check is real.
		expect(verifyRS256(forged, otherKeyPair.publicKey)).toBe(true);
	});

	it("rejects a token whose payload was tampered with after signing", () => {
		const jwt = GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey);
		const { header, payload, signature } = decode(jwt);
		const escalated = Buffer.from(
			JSON.stringify({ ...payload, iss: "999999" }),
		).toString("base64url");
		const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");

		expect(verifyRS256(`${headerB64}.${escalated}.${signature}`)).toBe(false);
	});

	it("rejects the classic alg:none downgrade", () => {
		const { payload } = decode(GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey));
		const headerB64 = Buffer.from(
			JSON.stringify({ alg: "none", typ: "JWT" }),
		).toString("base64url");
		const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

		expect(verifyRS256(`${headerB64}.${payloadB64}.`)).toBe(false);
	});

	it("rejects an HS256 substitution signed with the public key as the HMAC secret", () => {
		const { payload } = decode(GitHubAppFlow.generateJWT(APP_ID, keyPair.privateKey));
		const headerB64 = Buffer.from(
			JSON.stringify({ alg: "HS256", typ: "JWT" }),
		).toString("base64url");
		const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
		const hmac = createHmac("sha256", keyPair.publicKey)
			.update(`${headerB64}.${payloadB64}`)
			.digest("base64url");

		expect(verifyRS256(`${headerB64}.${payloadB64}.${hmac}`)).toBe(false);
	});
});

describe("GitHubAppFlow.getInstallationToken", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("parses a successful installation-token response", async () => {
		const expiresAt = "2026-08-05T12:00:00Z";
		fetchMock.mockResolvedValue(
			jsonResponse({
				token: "ghs_installation_token",
				expires_at: expiresAt,
				permissions: { contents: "read", issues: "write" },
				repository_selection: "selected",
			}),
		);

		const result = await GitHubAppFlow.getInstallationToken("jwt-value", "42");

		expect(result).toEqual({
			token: "ghs_installation_token",
			expiresAt: new Date(expiresAt),
			permissions: { contents: "read", issues: "write" },
			repositorySelection: "selected",
		});
	});

	it("POSTs to the installation endpoint with the JWT as a bearer token", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				token: "t",
				expires_at: "2026-08-05T12:00:00Z",
				permissions: {},
				repository_selection: "all",
			}),
		);

		await GitHubAppFlow.getInstallationToken("jwt-value", "42");

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(
			"https://api.github.com/app/installations/42/access_tokens",
		);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer jwt-value",
		);
		expect(JSON.parse(init.body as string)).toEqual({});
	});

	it("scopes the token to the requested permissions and repositories", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				token: "t",
				expires_at: "2026-08-05T12:00:00Z",
				permissions: { contents: "read" },
				repository_selection: "selected",
			}),
		);

		await GitHubAppFlow.getInstallationToken(
			"jwt-value",
			"42",
			{ contents: "read" },
			[1, 2],
		);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			permissions: { contents: "read" },
			repository_ids: [1, 2],
		});
	});

	it("omits repository_ids when the list is empty", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				token: "t",
				expires_at: "2026-08-05T12:00:00Z",
				permissions: {},
				repository_selection: "all",
			}),
		);

		await GitHubAppFlow.getInstallationToken("jwt-value", "42", undefined, []);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({});
	});

	it("throws on a non-2xx response without leaking the response body", async () => {
		fetchMock.mockResolvedValue(
			new Response("private-key-fingerprint-leak", { status: 401 }),
		);

		const error = await GitHubAppFlow.getInstallationToken(
			"jwt-value",
			"42",
		).catch((e: unknown) => e as Error);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(
			"GitHub installation token exchange failed (HTTP 401)",
		);
		expect((error as Error).message).not.toContain(
			"private-key-fingerprint-leak",
		);
	});

	it("surfaces a malformed provider body as an error, not a half-populated token", async () => {
		fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));

		await expect(
			GitHubAppFlow.getInstallationToken("jwt-value", "42"),
		).rejects.toThrow();
	});

	it("throws when a 200 response carries no token", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ expires_at: "2026-08-05T12:00:00Z", permissions: {} }),
		);

		await expect(
			GitHubAppFlow.getInstallationToken("jwt-value", "42"),
		).rejects.toThrow("GitHub installation token response has no token");
	});
});

describe("GitHubAppFlow installation listing", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("lists installations", async () => {
		fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }, { id: 2 }]));

		const installations = await GitHubAppFlow.listInstallations("jwt-value");

		expect(installations.map((i) => i.id)).toEqual([1, 2]);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.github.com/app/installations");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer jwt-value",
		);
	});

	it("throws when listing installations fails", async () => {
		fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));

		await expect(GitHubAppFlow.listInstallations("jwt-value")).rejects.toThrow(
			"GitHub list installations failed (HTTP 403)",
		);
	});

	it("fetches a single installation and throws on failure", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ id: 7 }));
		await expect(
			GitHubAppFlow.getInstallation("jwt-value", "7"),
		).resolves.toMatchObject({ id: 7 });

		fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
		await expect(
			GitHubAppFlow.getInstallation("jwt-value", "7"),
		).rejects.toThrow("GitHub get installation failed (HTTP 404)");
	});
});

describe("GitHubAppFlow.isTokenExpired", () => {
	it("treats a past expiry as expired", () => {
		expect(GitHubAppFlow.isTokenExpired(new Date(Date.now() - 1000))).toBe(true);
	});

	it("treats an expiry inside the 5-minute buffer as expired", () => {
		expect(GitHubAppFlow.isTokenExpired(new Date(Date.now() + 60_000))).toBe(
			true,
		);
	});

	it("treats an expiry beyond the buffer as valid", () => {
		expect(GitHubAppFlow.isTokenExpired(new Date(Date.now() + 3_600_000))).toBe(
			false,
		);
	});

	it("accepts an ISO string and a custom buffer", () => {
		const in10Min = new Date(Date.now() + 600_000).toISOString();
		expect(GitHubAppFlow.isTokenExpired(in10Min)).toBe(false);
		expect(GitHubAppFlow.isTokenExpired(in10Min, 900_000)).toBe(true);
	});
});
