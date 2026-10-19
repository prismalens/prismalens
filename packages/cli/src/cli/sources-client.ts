// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How `pl connect` and `pl sources` reach the running instance: over its own
 * HTTP API, as a device paired through the workspace the way `pl pair` mints
 * links. Whoever can run this already holds the workspace; it grants nothing new.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { lockBase } from "./instance-check.js";

const TOKEN_FILE = "cli-device.token";

export class SourcesClientError extends Error {}

export interface SourcesClient {
	post<T>(path: string, body: unknown): Promise<T>;
	get<T>(path: string): Promise<T>;
}

export async function sourcesClient(): Promise<SourcesClient> {
	const { getAppDataDir, readWorkspaceLock } = await import(
		"@prismalens/config"
	);
	const workspaceDir = getAppDataDir();
	const lock = readWorkspaceLock(workspaceDir);
	if (!lock)
		throw new SourcesClientError(
			`No \`pl up\` is running on ${workspaceDir}. Start it, then connect.`,
		);
	const base = lockBase(lock);
	const tokenPath = join(workspaceDir, TOKEN_FILE);
	let token = existsSync(tokenPath)
		? readFileSync(tokenPath, "utf8").trim()
		: "";

	const send = async <T>(method: string, path: string, body?: unknown) => {
		for (let attempt = 0; ; attempt++) {
			if (!token) {
				token = await pairCli(workspaceDir, base);
				writeFileSync(tokenPath, token, { mode: 0o600 });
			}
			const res = await fetch(`${base}/api${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			if (res.status === 401 && attempt === 0) {
				token = "";
				continue;
			}
			const data: unknown = await res.json().catch(() => null);
			if (!res.ok)
				throw new SourcesClientError(
					(data as { message?: string } | null)?.message ??
						`The instance answered HTTP ${res.status}`,
				);
			return data as T;
		}
	};
	return {
		get: (path) => send("GET", path),
		post: (path, body) => send("POST", path, body),
	};
}

/** Mints a link in the workspace and redeems it, keeping the device token the cookie carries. */
async function pairCli(workspaceDir: string, base: string): Promise<string> {
	const { createPairingLinkInWorkspace, DEVICE_COOKIE_PREFIX } = await import(
		"@prismalens/auth"
	);
	const link = await createPairingLinkInWorkspace(workspaceDir, {
		label: `pl on ${hostname() || "this machine"}`,
	});
	const res = await fetch(`${base}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: link.token, name: "pl (command line)" }),
	});
	const token = deviceTokenFrom(
		res.headers.getSetCookie(),
		DEVICE_COOKIE_PREFIX,
	);
	if (!res.ok || !token)
		throw new SourcesClientError(
			`Could not pair the command line with the instance (HTTP ${res.status}).`,
		);
	return token;
}

export function deviceTokenFrom(
	setCookies: string[],
	prefix: string,
): string | null {
	for (const c of setCookies) {
		const [pair] = c.split(";");
		const eq = pair?.indexOf("=") ?? -1;
		if (pair && eq > 0 && pair.slice(0, eq).trim().startsWith(prefix))
			return decodeURIComponent(pair.slice(eq + 1).trim());
	}
	return null;
}
