// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Capture sanitizer (#262) — redacts secrets and normalizes paths in serialized
 * capture JSON before persistence. Applied at the write choke-point so every
 * persisted field (tool output, args, previews, agent text) is sanitized
 * uniformly without per-field call sites.
 *
 * Four redaction classes (plus a PEM-block pre-pass feeding class 1):
 * 0. PEM/private-key blocks: `-----BEGIN … KEY-----…-----END … KEY-----` → body masked
 * 1. Env-style credentials: `KEY=value` → `KEY=[REDACTED]`
 * 2. Credential-bearing URIs: `scheme://user:pass@host` → `scheme://user:[REDACTED]@host`
 * 3. Emails in VCS output: `Author: Name <email>` → `Author: Name <redacted@redacted.invalid>`
 * 4. Home paths: `/home/<user>` → `/home/user` (also flattened `-home-<user>-` forms)
 */

import { writeFileSync } from "node:fs";

/**
 * Keys whose values are known-public and must NOT be redacted.
 * Docker base images expose `GPG_KEY` with a package-signing fingerprint — a
 * public value that appears in every `docker inspect` / `docker exec env` dump.
 */
const ALLOWLISTED_KEYS = new Set(["GPG_KEY"]);

// ---------------------------------------------------------------------------
// Rule 0: PEM / private-key blocks
// ---------------------------------------------------------------------------
// Rule 1 terminates a value at the first newline, so a dumped keyfile would
// persist everything past line 1 (`PRIVATE_KEY=[REDACTED]\nMIIEow...`). This
// rule collapses the whole armoured block first, so the body cannot survive.
// Only `...KEY-----` blocks match — `BEGIN CERTIFICATE` is public and is
// deliberately left alone. The body class excludes `"` so a block can never be
// swallowed across a JSON string boundary; the backreference keeps the
// BEGIN/END labels paired. Runs BEFORE rule 1, which would otherwise eat the
// BEGIN marker and leave the body unmatchable.
const PEM_BLOCK_RE =
	/-----BEGIN ([A-Z0-9 ]*?)KEY-----[^"]*?-----END \1KEY-----/g;

function redactPemBlocks(input: string): string {
	return input.replace(
		PEM_BLOCK_RE,
		(_match, label: string) =>
			`-----BEGIN ${label}KEY-----[REDACTED]-----END ${label}KEY-----`,
	);
}

// ---------------------------------------------------------------------------
// Rule 1: Env-style credentials
// ---------------------------------------------------------------------------
// Matches `KEY=value` in env-dump and docker-inspect style output, where KEY is
// ALL-UPPERCASE and CONTAINS PASSWORD, SECRET, TOKEN, or KEY anywhere in the
// name. Matching is deliberately not anchored to the end of the key: names like
// `SECRET_KEY_BASE` and `OPENAI_APIKEY` carry the secret word in the middle, and
// a suffix-only rule let them through. Over-matching (e.g. `KEYCLOAK_URL`) is
// the safe direction for a redactor — a masked non-secret costs nothing, a
// persisted secret is unrecoverable.
//
// The value runs until a JSON-escaped `\n` (literal `\\n` in the JSON text), a
// JSON-escaped `"` (literal `\\"` in the JSON text), or an actual `"` (end of
// JSON string).
//
// The key MUST be all-uppercase+underscore to avoid false positives on
// Python/Ruby code patterns like `primary_key=True` or `secret_key_base=Rails`.
// No case-insensitive flag — env variable names are conventionally SCREAMING_CASE.
const ENV_CREDENTIAL_RE =
	/(?<=\\n|\\"|^"|"|\s)((?=[A-Z])[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY)[A-Z0-9_]*)=([^\s"\\][^"\\]*?)(?=\\n|\\"|"|$)/gm;

/**
 * Redact env-style credential values, skipping allowlisted keys.
 */
function redactEnvCredentials(input: string): string {
	return input.replace(ENV_CREDENTIAL_RE, (match, key: string) => {
		if (ALLOWLISTED_KEYS.has(key)) return match;
		// If the value is already [REDACTED], skip
		const eqIdx = match.indexOf("=");
		const value = match.slice(eqIdx + 1);
		if (value.startsWith("[REDACTED]")) return match;
		return `${match.slice(0, eqIdx + 1)}[REDACTED]`;
	});
}

// ---------------------------------------------------------------------------
// Rule 2: Credential-bearing URIs
// ---------------------------------------------------------------------------
// Matches `scheme://user:password@host` and replaces the password with [REDACTED].
// Skips URIs where the password is already [REDACTED].
const CREDENTIAL_URI_RE = /(\w+:\/\/[^/:@\s]+):([^@/\s\\]+)(@[^"\\,\s]+)/g;

function redactCredentialUris(input: string): string {
	return input.replace(
		CREDENTIAL_URI_RE,
		(_match, pre: string, pass: string, post: string) => {
			if (pass === "[REDACTED]") return `${pre}:${pass}${post}`;
			return `${pre}:[REDACTED]${post}`;
		},
	);
}

// ---------------------------------------------------------------------------
// Rule 3: Emails in VCS output
// ---------------------------------------------------------------------------
// Matches `Author: Name <email@domain>` lines and variants (Commit, Tagger).
// Skips addresses already at `redacted.invalid` (idempotency with #261 scrub).
const VCS_EMAIL_RE = /((?:Author|Commit|Tagger):\s+[^<]+)<([^>]+@[^>]+)>/gi;

function redactVcsEmails(input: string): string {
	return input.replace(
		VCS_EMAIL_RE,
		(_match, prefix: string, email: string) => {
			if (email.endsWith("@redacted.invalid")) {
				return `${prefix}<${email}>`;
			}
			return `${prefix}<redacted@redacted.invalid>`;
		},
	);
}

// ---------------------------------------------------------------------------
// Rule 4: Home path normalization
// ---------------------------------------------------------------------------
// Normalizes `/home/<user>` → `/home/user` for any username that isn't already
// the literal `user`. Also handles the flattened `-home-<user>-` form.
const HOME_PATH_RE = /\/home\/(?!user[\\/\s"\\-])([a-z_][a-z0-9_-]{0,31})/g;
const FLAT_HOME_RE = /-home-(?!user-)([a-z_][a-z0-9_-]{0,31})-/g;

function normalizeHomePaths(input: string): string {
	return input
		.replace(HOME_PATH_RE, "/home/user")
		.replace(FLAT_HOME_RE, "-home-user-");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a serialized capture JSON string by applying all four redaction
 * classes. The JSON structure is not parsed/re-serialized — replacements are
 * string-level so the output is byte-for-byte identical on already-clean input
 * (the no-op-on-clean-captures invariant from #261).
 */
export function sanitizeCapture(json: string): string {
	let result = json;
	// PEM blocks first — rule 1 stops at the first newline and would otherwise
	// consume the BEGIN marker, stranding the key body in the capture.
	result = redactPemBlocks(result);
	result = redactEnvCredentials(result);
	result = redactCredentialUris(result);
	result = redactVcsEmails(result);
	result = normalizeHomePaths(result);
	return result;
}

/**
 * Serialize and sanitize a capture object, then write it.
 * This is the single choke-point that all capture persistence paths should use.
 *
 * Not atomic — this is a plain `writeFileSync`, so a crash mid-write leaves a
 * truncated file. Callers that need a collision-free reservation pass
 * `{ flag: "wx" }`; callers that need crash-atomicity must write-then-rename
 * themselves.
 *
 * @param path     — absolute path to write the capture JSON to
 * @param data     — the capture object (will be stringified with 2-space indent)
 * @param options  — optional `writeFileSync` options (e.g. `{ flag: "wx" }`)
 */
export function writeSanitizedCapture(
	path: string,
	data: unknown,
	options?: { flag?: string },
): void {
	const json = JSON.stringify(data, null, 2);
	writeFileSync(path, sanitizeCapture(json), options);
}
