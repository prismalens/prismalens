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

export interface Stored {
	credential: ParsedSourceCredential;
	/** The URL kept beside the token (GitHub, GitLab, Bitbucket); config holds it otherwise. */
	baseUrl?: string;
}

export function readStored(templateId: string, blob: unknown): Stored {
	const obj =
		blob && typeof blob === "object" ? (blob as Record<string, unknown>) : {};
	const tokenField = sourceType(templateId)?.tokenField;
	const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl : undefined;
	if (tokenField && typeof obj.kind !== "string") {
		return {
			credential: parseSourceCredential({
				kind: "bearer",
				token: obj[tokenField],
			}),
			...(baseUrl ? { baseUrl } : {}),
		};
	}
	if (!tokenField) return { credential: parseSourceCredential(obj) };
	const { baseUrl: _drop, ...rest } = obj;
	return {
		credential: parseSourceCredential(rest),
		...(baseUrl ? { baseUrl } : {}),
	};
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
