// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * GitHub App authentication flow.
 * Generates JWTs and exchanges them for installation access tokens.
 * Pure/stateless — no NestJS dependencies (consistent with OAuth2Flow).
 */
import { createSign } from "node:crypto";
import { providerJsonParseError } from "./provider-http-error.js";

export interface InstallationTokenResult {
	token: string;
	expiresAt: Date;
	permissions: Record<string, string>;
	repositorySelection: string;
}

export interface GitHubInstallation {
	id: number;
	account: {
		login: string;
		id: number;
		type: string;
		avatar_url?: string;
	};
	app_id: number;
	target_type: string;
	permissions: Record<string, string>;
	events: string[];
	repository_selection: string;
	created_at: string;
	updated_at: string;
}

const GITHUB_API = "https://api.github.com";
const FETCH_TIMEOUT_MS = 10_000;

/** Create an AbortSignal that times out after FETCH_TIMEOUT_MS */
function timeoutSignal(): AbortSignal {
	return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

/**
 * Generate a JWT for authenticating as the GitHub App.
 * RS256-signed, valid for 10 minutes.
 */
function generateJWT(appId: string, privateKey: string): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const payload = {
		iss: appId,
		iat: now - 60, // 60s clock drift buffer
		exp: now + 600, // 10 min max
	};

	const encodeBase64Url = (data: string): string =>
		Buffer.from(data).toString("base64url");

	const headerB64 = encodeBase64Url(JSON.stringify(header));
	const payloadB64 = encodeBase64Url(JSON.stringify(payload));
	const signingInput = `${headerB64}.${payloadB64}`;

	const sign = createSign("RSA-SHA256");
	sign.update(signingInput);
	const signature = sign.sign(privateKey, "base64url");

	return `${signingInput}.${signature}`;
}

/**
 * Exchange a JWT for an installation access token.
 * Optionally scope to specific permissions or repository IDs.
 */
function isStringMap(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((v) => typeof v === "string")
	);
}

/**
 * True when `parsed` still names the calendar day the string asked for.
 *
 * `new Date("2026-02-30T12:00:00Z")` is not an Invalid Date — it is March 2nd.
 * Comparing the day back out is what separates a real date from a normalised
 * one. Anything that does not look like an ISO date at all is rejected, which
 * is correct for a field GitHub documents as RFC 3339.
 */
function isCalendarDate(value: string, parsed: Date): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
	if (!match) return false;
	const [, year, month, day] = match;
	// The literal fields are UTC in GitHub's responses; compare in UTC so an
	// explicit offset cannot shift the day out from under the check.
	const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	return (
		utc.getUTCFullYear() === Number(year) &&
		utc.getUTCMonth() === Number(month) - 1 &&
		utc.getUTCDate() === Number(day) &&
		!Number.isNaN(parsed.getTime())
	);
}

async function getInstallationToken(
	jwt: string,
	installationId: string,
	permissions?: Record<string, string>,
	repositoryIds?: number[],
): Promise<InstallationTokenResult> {
	const body: Record<string, unknown> = {};
	if (permissions) body.permissions = permissions;
	if (repositoryIds?.length) body.repository_ids = repositoryIds;

	const response = await fetch(
		`${GITHUB_API}/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github.v3+json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: timeoutSignal(),
		},
	);

	if (!response.ok) {
		throw new Error(
			`GitHub installation token exchange failed (HTTP ${response.status})`,
		);
	}

	// An unguarded parse would throw a SyntaxError quoting the body — here that
	// body is an installation-token response. See provider-http-error.ts (#347).
	let data: {
		token: string;
		expires_at: string;
		permissions: Record<string, string>;
		repository_selection: string;
	};
	try {
		data = (await response.json()) as typeof data;
	} catch {
		throw providerJsonParseError({
			operation: "GitHub installation token exchange",
			response,
		});
	}

	// A 2xx with no token is not a success — never hand back a credential
	// whose token is undefined.
	if (typeof data.token !== "string" || data.token.trim().length === 0) {
		throw new Error("GitHub installation token response has no token");
	}

	// `expires_at` decides when this credential is refreshed. A missing or
	// unparseable one becomes an Invalid Date, which compares false against every
	// deadline: the token would be treated as valid forever (#346). Throw instead.
	//
	// `Number.isNaN` is not enough on its own. `new Date` rejects a month or hour
	// out of range but silently NORMALISES a day out of range, so
	// "2026-02-30T12:00:00Z" becomes 2026-03-02 — a real Date, two days later
	// than anything the sender meant, scheduling the refresh after the token has
	// already expired. `isCalendarDate` re-reads the day back out to catch it.
	const expiresAt =
		typeof data.expires_at === "string"
			? new Date(data.expires_at)
			: new Date(Number.NaN);
	if (
		Number.isNaN(expiresAt.getTime()) ||
		!isCalendarDate(data.expires_at, expiresAt)
	) {
		throw new Error(
			"GitHub installation token response has no usable expires_at",
		);
	}

	return {
		token: data.token,
		expiresAt,
		// The other two are advisory, so they degrade to the least access rather
		// than failing an exchange that produced a usable token (#346): an empty
		// permission map fails every capability check, and an unrecognised
		// selection is read as the narrower "selected".
		permissions: isStringMap(data.permissions) ? data.permissions : {},
		repositorySelection:
			data.repository_selection === "all" ? "all" : "selected",
	};
}

/**
 * List all installations for the GitHub App.
 */
async function listInstallations(jwt: string): Promise<GitHubInstallation[]> {
	const response = await fetch(`${GITHUB_API}/app/installations`, {
		headers: {
			Authorization: `Bearer ${jwt}`,
			Accept: "application/vnd.github.v3+json",
		},
		signal: timeoutSignal(),
	});

	if (!response.ok) {
		throw new Error(
			`GitHub list installations failed (HTTP ${response.status})`,
		);
	}

	// Same guard as above: a SyntaxError would quote the provider's body.
	try {
		return (await response.json()) as GitHubInstallation[];
	} catch {
		throw providerJsonParseError({
			operation: "GitHub list installations",
			response,
		});
	}
}

/**
 * Get details for a single installation.
 */
async function getInstallation(
	jwt: string,
	installationId: string,
): Promise<GitHubInstallation> {
	const response = await fetch(
		`${GITHUB_API}/app/installations/${installationId}`,
		{
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github.v3+json",
			},
			signal: timeoutSignal(),
		},
	);

	if (!response.ok) {
		throw new Error(`GitHub get installation failed (HTTP ${response.status})`);
	}

	// Same guard as above: a SyntaxError would quote the provider's body.
	try {
		return (await response.json()) as GitHubInstallation;
	} catch {
		throw providerJsonParseError({
			operation: "GitHub get installation",
			response,
		});
	}
}

/**
 * Check if a token is expired or expiring soon.
 * Default buffer: 5 minutes (GitHub App tokens last 1 hour).
 */
function isTokenExpired(expiresAt: Date | string, bufferMs = 300_000): boolean {
	const expiry =
		typeof expiresAt === "string"
			? new Date(expiresAt).getTime()
			: expiresAt.getTime();
	return expiry - bufferMs < Date.now();
}

export const GitHubAppFlow = {
	generateJWT,
	getInstallationToken,
	listInstallations,
	getInstallation,
	isTokenExpired,
};
