/**
 * GitHub App authentication flow.
 * Generates JWTs and exchanges them for installation access tokens.
 * Pure/stateless — no NestJS dependencies (consistent with OAuth2Flow).
 */
import { createSign } from "node:crypto";

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

	const data = (await response.json()) as {
		token: string;
		expires_at: string;
		permissions: Record<string, string>;
		repository_selection: string;
	};

	return {
		token: data.token,
		expiresAt: new Date(data.expires_at),
		permissions: data.permissions,
		repositorySelection: data.repository_selection,
	};
}

/**
 * List all installations for the GitHub App.
 */
async function listInstallations(
	jwt: string,
): Promise<GitHubInstallation[]> {
	const response = await fetch(
		`${GITHUB_API}/app/installations`,
		{
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github.v3+json",
			},
			signal: timeoutSignal(),
		},
	);

	if (!response.ok) {
		throw new Error(
			`GitHub list installations failed (HTTP ${response.status})`,
		);
	}

	return (await response.json()) as GitHubInstallation[];
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
		throw new Error(
			`GitHub get installation failed (HTTP ${response.status})`,
		);
	}

	return (await response.json()) as GitHubInstallation;
}

/**
 * Check if a token is expired or expiring soon.
 * Default buffer: 5 minutes (GitHub App tokens last 1 hour).
 */
function isTokenExpired(
	expiresAt: Date | string,
	bufferMs = 300_000,
): boolean {
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
