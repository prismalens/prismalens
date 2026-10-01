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

import { DEVICE_COOKIE_PREFIX } from "@prismalens/auth/device-cookie";

/** The 0.5.0 cookie name, before each instance named its own. */
export const LEGACY_DEVICE_COOKIE = DEVICE_COOKIE_PREFIX;
const ACCESS_SCOPE = "admin:access";
/** What the device list calls this window. */
export const DEVICE_NAME = "Desktop app";

/** The token in the first `/pair#<token>` link `pl pair` printed. */
export function parsePairingToken(stdout: string): string | null {
	return stdout.match(/\/pair#([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

/** The device token a redeem answer set under `cookieName`, from its `Set-Cookie` headers. */
export function deviceTokenFrom(
	setCookie: string[],
	cookieName: string,
): string | null {
	const prefix = `${cookieName}=`;
	const cookie = setCookie.find((c) => c.startsWith(prefix));
	if (!cookie) return null;
	const value = cookie.slice(prefix.length).split(";")[0] ?? "";
	return value ? decodeURIComponent(value) : null;
}

export class OlderBackendError extends Error {
	constructor(baseUrl: string) {
		super(`${baseUrl} has no /api/instance; it predates this app.`);
		this.name = "OlderBackendError";
	}
}

/** Which instance answers at `baseUrl`. A 404 means a PrismaLens older than the app. */
export async function fetchInstanceId(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string> {
	const res = await fetchImpl(`${baseUrl}/api/instance`);
	if (res.status === 404) throw new OlderBackendError(baseUrl);
	if (!res.ok)
		throw new Error(`${baseUrl}/api/instance answered ${res.status}`);
	const body = (await res.json()) as { instanceId?: unknown };
	if (typeof body.instanceId !== "string" || !body.instanceId) {
		throw new Error(`${baseUrl}/api/instance named no instance`);
	}
	return body.instanceId;
}

/**
 * The stored tokens worth sending to `instanceId`, in order. A token is only
 * sent where the recorded id matches (accident prevention, the id is public).
 * The 0.5.0 cookie predates any record, so it is tried once, before one exists (#763).
 */
export function storedCandidates(input: {
	instanceId: string;
	expectedId: string | null;
	stored: string | null;
	legacy: string | null;
}): string[] {
	if (input.expectedId === null) return input.legacy ? [input.legacy] : [];
	if (input.expectedId !== input.instanceId) return [];
	return input.stored ? [input.stored] : [];
}

export interface SessionDeps {
	baseUrl: string;
	/** The per-instance cookie name the backend sets, `deviceCookieName(instanceId)`. */
	cookieName: string;
	/** Stored tokens that passed the identity check, tried in order. */
	candidates: string[];
	/** Runs `pl pair --operator` on the workspace and returns its stdout. */
	pairOperator: () => Promise<string>;
	fetchImpl?: typeof fetch;
}

/** A device token that holds the operator's scopes: a stored one, or a fresh one. */
export async function operatorToken(deps: SessionDeps): Promise<string> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	for (const token of deps.candidates) {
		if (await managesPairing(deps, token)) return token;
	}
	const link = parsePairingToken(await deps.pairOperator());
	if (!link) throw new Error("`pl pair --operator` printed no link");
	const res = await fetchImpl(`${deps.baseUrl}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: deps.baseUrl },
		body: JSON.stringify({ token: link, name: DEVICE_NAME }),
	});
	const token = deviceTokenFrom(res.headers.getSetCookie(), deps.cookieName);
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
