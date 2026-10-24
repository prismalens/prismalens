// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The one reader and writer of a source's stored credential blob (#848, OBJ-009).
 * Legacy git-host rows `{[tokenField]: token, baseUrl?}` read as `bearer` and round-trip unchanged.
 */
import {
	type ParsedSourceCredential,
	parseSourceCredential,
	type SourceCredential,
	sourceType,
} from "@prismalens/contracts/schemas";

/** `absent`: no kind and no token was ever saved; an explicit `{ kind: "none" }` is `set` (#848). */
export type StoredState = "set" | "absent" | "invalid";

export interface Stored {
	credential: ParsedSourceCredential;
	state: StoredState;
	/** The URL kept beside the token (GitHub, GitLab, Bitbucket); config holds it otherwise. */
	baseUrl?: string;
}

const stateOf = (c: ParsedSourceCredential): StoredState =>
	c.ok ? "set" : "invalid";

export function readStored(templateId: string, blob: unknown): Stored {
	const obj =
		blob && typeof blob === "object" ? (blob as Record<string, unknown>) : {};
	const tokenField = sourceType(templateId)?.tokenField;
	const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl : undefined;
	const url = baseUrl ? { baseUrl } : {};
	const token = tokenField ? obj[tokenField] : undefined;
	if (
		typeof obj.kind !== "string" &&
		(token === undefined || (typeof token === "string" && !token.trim()))
	)
		return {
			credential: { ok: true, credential: { kind: "none" } },
			state: "absent",
			...url,
		};
	if (tokenField && typeof obj.kind !== "string") {
		const credential = parseSourceCredential({ kind: "bearer", token });
		return { credential, state: stateOf(credential), ...url };
	}
	const { baseUrl: _drop, ...rest } = obj;
	const credential = parseSourceCredential(tokenField ? rest : obj);
	return { credential, state: stateOf(credential), ...url };
}

export function writeStored(
	templateId: string,
	credential: SourceCredential,
	baseUrl?: string,
): Record<string, unknown> {
	const tokenField = sourceType(templateId)?.tokenField;
	const url = baseUrl ? { baseUrl } : {};
	if (tokenField && credential.kind === "bearer")
		return { [tokenField]: credential.token, ...url };
	const clean = Object.fromEntries(
		Object.entries(credential).filter(([, v]) => v !== undefined),
	);
	return { ...clean, ...url };
}
