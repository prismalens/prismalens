// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The window's own session (ADR 0004 §8). Being on the host grants nothing,
 * so the launcher pairs like any browser: it keeps the device token of an
 * earlier run while that still holds the operator's scopes, or runs
 * `pl pair --operator` as its child, reads the link off the child's stdout
 * (never argv or the environment), and redeems it. The same path serves a
 * backend the launcher spawned and one it attached to.
 */

export const DEVICE_COOKIE = "prismalens.device";
const ACCESS_SCOPE = "admin:access";

/** The token in the first `/pair#<token>` link `pl pair` printed. */
export function parsePairingToken(stdout: string): string | null {
	return stdout.match(/\/pair#([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

/** The device token a redeem answer set, from its `Set-Cookie` headers. */
export function deviceTokenFrom(setCookie: string[]): string | null {
	const prefix = `${DEVICE_COOKIE}=`;
	const cookie = setCookie.find((c) => c.startsWith(prefix));
	if (!cookie) return null;
	const value = cookie.slice(prefix.length).split(";")[0] ?? "";
	return value ? decodeURIComponent(value) : null;
}

export interface SessionDeps {
	baseUrl: string;
	/** The token an earlier run left in the window's cookie jar, if any. */
	storedToken: string | null;
	/** Runs `pl pair --operator` on the workspace and returns its stdout. */
	pairOperator: () => Promise<string>;
	fetchImpl?: typeof fetch;
}

/** A device token that holds the operator's scopes: the stored one, or a fresh one. */
export async function operatorToken(deps: SessionDeps): Promise<string> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	if (deps.storedToken && (await managesPairing(deps, deps.storedToken))) {
		return deps.storedToken;
	}
	const link = parsePairingToken(await deps.pairOperator());
	if (!link) throw new Error("`pl pair --operator` printed no link");
	const res = await fetchImpl(`${deps.baseUrl}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: deps.baseUrl },
		body: JSON.stringify({ token: link }),
	});
	const token = deviceTokenFrom(res.headers.getSetCookie());
	if (!res.ok || !token) {
		throw new Error(`Pairing the window failed: ${res.status}`);
	}
	return token;
}

async function managesPairing(
	deps: SessionDeps,
	token: string,
): Promise<boolean> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	try {
		const res = await fetchImpl(`${deps.baseUrl}/api/operator/whoami`, {
			headers: { authorization: `Bearer ${token}` },
		});
		if (!res.ok) return false;
		const body = (await res.json()) as { scopes?: string[] };
		return body.scopes?.includes(ACCESS_SCOPE) ?? false;
	} catch {
		return false;
	}
}
