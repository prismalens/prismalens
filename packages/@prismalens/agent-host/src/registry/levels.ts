// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The four permission levels, in display order; the values `app.prisma` already stores. */
export const ACCESS_LEVELS = [
	"supervised",
	"auto-edits",
	"auto",
	"full-access",
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const DEFAULT_ACCESS_LEVEL: AccessLevel = "supervised";

/** How a mode reaches the agent: ACP `session/set_mode` (or its `mode` config option), or not at all. */
export type ModeMechanism = "acp" | "none";

export type JsonObject = Record<string, unknown>;

export const isJsonObject = (v: unknown): v is JsonObject =>
	!!v && typeof v === "object" && !Array.isArray(v);

/** One permission level on one agent: the agent's own mode, a config overlay, or nothing to set. */
export interface LevelFacts {
	/** The agent's own mode id; null when the agent has no modes and the host answers each ask. */
	mode: string | null;
	/** Run when `mode` is not offered, or the agent refuses it. */
	fallbackMode?: string;
	/** Deep-merged into the row's generated JSON config files; `user` is the user's own config the agent loads before them. */
	configPatch?: (user: JsonObject) => JsonObject;
	/** Recorded as the run's `fidelity.mechanism`. */
	mechanism: string;
}

/** Where the agent's setup comes from. Locally both products inherit; the cloud value's shape is decided with cloud work (#916). */
export const USER_SETUPS = ["inherit", "supplied"] as const;
export type UserSetup = (typeof USER_SETUPS)[number];

/** `patch` over `base`, objects merged key by key, so keys the patch does not name stay. */
export function mergeConfigPatch(
	base: JsonObject,
	patch: JsonObject,
): JsonObject {
	const out: JsonObject = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const prev = out[key];
		out[key] =
			isJsonObject(prev) && isJsonObject(value)
				? mergeConfigPatch(prev, value)
				: value;
	}
	return out;
}

/** A gateway receives the auth token, so plain http is allowed only on loopback. */
export function isSafeGatewayUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	const host = url.hostname.replace(/^\[|\]$/g, "");
	return (
		url.protocol === "http:" &&
		(host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host))
	);
}
