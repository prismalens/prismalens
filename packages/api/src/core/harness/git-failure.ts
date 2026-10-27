// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunCredential } from "@prismalens/contracts/schemas";

export type GitFailureCode =
	| "no-credential"
	| "token-rejected"
	| "token-expired"
	| "no-access"
	| "machine-rejected"
	| "not-found"
	| "ssh-host-key"
	| "ssh-key-refused"
	| "ambiguous"
	| "unreachable"
	| "other";

export type GitFailureAction =
	| "add-credential"
	| "pick-credential"
	| "replace-token";

/** A git call that failed, in words the user can act on. `message` is fixed text; `stderr` is scrubbed, for classification only, never logged or returned (#848). */
export class GitFailure extends Error {
	constructor(
		readonly code: GitFailureCode,
		message: string,
		readonly action?: GitFailureAction,
		readonly stderr?: string,
	) {
		super(message);
		this.name = "GitFailure";
	}
}

/** At most 64 KB of remote output is scanned, since the patterns below are not all linear (#848). */
const MAX_SCANNED_STDERR = 64 * 1024;
const HALF = MAX_SCANNED_STDERR / 2 - 1;

/** The first and last 32 KB, each cut at a line break: git's `fatal:` line comes last (#938). */
function scanned(stderr: string): string {
	if (stderr.length <= MAX_SCANNED_STDERR) return stderr;
	const head = stderr.slice(0, HALF);
	const tail = stderr.slice(-HALF);
	const headEnd = Math.max(head.lastIndexOf("\n"), head.lastIndexOf("\r")) + 1;
	const tailStart = tail.search(/[\r\n]/);
	return `${head.slice(0, headEnd)}\n${tailStart < 0 ? "" : tail.slice(tailStart + 1)}`;
}

/** Strips anything that looks like a credential from git's stderr. */
export function scrubGitStderr(stderr: string): string {
	return scanned(stderr)
		.replace(/Authorization:\s*\S+\s+\S+/gi, "Authorization: ***")
		.replace(/:\/\/[^/@\s]+@/g, "://***@");
}

export interface DiagnoseInput {
	stderr: string;
	credential: Pick<RunCredential, "source" | "label" | "via" | "fingerprint">;
	host: string;
	/** `owner/repo`. */
	repo: string;
	tokenExpiresAt?: Date | null;
	sshAuthSockSet: boolean;
	now?: Date;
}

const has = (stderr: string, re: RegExp) => re.test(stderr);
const COULD_NOT_READ_USER = /could not read Username/i;
const AUTH_FAILED = /Authentication failed for/i;
const HTTP_403 = /returned error: 403/i;
const HTTP_404 = /returned error: 404/i;
const REPO_NOT_FOUND = /repository '.*' not found/i;
const UNREACHABLE =
	/Could not resolve host|Failed to connect|Connection (refused|timed out)|Operation timed out|ssh: connect to host/i;

function tokenName(label: string): string {
	return label.replace(/^(token|env) /, "");
}

/** `(gh, sumit)` from `machine git (gh, sumit)`, or "" when the label has none. */
function machineDetail(label: string): string {
	const m = /\(([^)]*)\)\s*$/.exec(label);
	return m ? ` (${m[1]})` : "";
}

export function formatDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** What a git token connection stores: a code, never text; its sentence is built when shown (#848). */
export type GitErrorKind =
	| "token-expired"
	| "token-rejected"
	| "no-access"
	| "unreachable"
	| "other"
	| "no-token"
	| "failed";

const GIT_ERROR_KINDS: readonly string[] = [
	"token-expired",
	"token-rejected",
	"no-access",
	"unreachable",
	"other",
	"no-token",
	"failed",
];

export function gitErrorKind(code: string): GitErrorKind {
	return GIT_ERROR_KINDS.includes(code) ? (code as GitErrorKind) : "failed";
}

const GIT_HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

/** The sentence for a stored code, from the token's own host and label only; no repository is named. Null for an unknown code. */
export function gitErrorSentence(
	kind: string | undefined,
	token: { host: string | null; label: string },
): string | null {
	const host =
		token.host && GIT_HOST.test(token.host) ? token.host : "the git host";
	const label = token.label.replace(/\s+/g, " ");
	switch (kind) {
		case "token-expired":
			return `Token "${label}" has expired. Replace it in Settings → Sources.`;
		case "token-rejected":
			return `${host} rejected token "${label}". It was revoked or mistyped; replace it.`;
		case "no-access":
			return `Token "${label}" can't see a repository on ${host}: it doesn't exist or the token has no access to it. Check the URL or grant the repository on the token.`;
		case "unreachable":
			return `Could not reach ${host}.`;
		case "other":
			return `git could not read a repository on ${host}.`;
		case "no-token":
			return "This connection has no host or token.";
		case "failed":
			return "the check failed";
		default:
			return null;
	}
}

/** git's own message prefixes under `LC_ALL=C`, matched in table order (plan §1.4, #673). */
export function diagnoseGitFailure(input: DiagnoseInput): GitFailure {
	const { credential, host, repo } = input;
	const stderr = scrubGitStderr(input.stderr);
	const token = tokenName(credential.label);
	const fp = credential.fingerprint ? ` (fp ${credential.fingerprint})` : "";
	const fail = (
		code: GitFailureCode,
		message: string,
		action?: GitFailureAction,
	) => new GitFailure(code, message, action, stderr);
	// An env token is diagnosed like a saved one (#848).
	const source = credential.source === "env" ? "connection" : credential.source;
	const now = input.now ?? new Date();

	if (
		source === "connection" &&
		input.tokenExpiresAt &&
		input.tokenExpiresAt < now
	)
		return fail(
			"token-expired",
			`Token "${token}" expired on ${formatDay(input.tokenExpiresAt)}. Replace it in Settings → Sources.`,
			"replace-token",
		);
	if (
		source === "connection" &&
		(has(stderr, COULD_NOT_READ_USER) || has(stderr, AUTH_FAILED))
	)
		return fail(
			"token-rejected",
			`${host} rejected token "${token}"${fp}. It was revoked or mistyped; replace it.`,
			"replace-token",
		);
	if (
		source === "connection" &&
		(has(stderr, HTTP_403) || has(stderr, REPO_NOT_FOUND))
	)
		return fail(
			"no-access",
			`Token "${token}" can't see ${repo}: it doesn't exist or the token has no access to it. Check the URL or grant the repository on the token.`,
			"replace-token",
		);
	if (
		source === "machine" &&
		(has(stderr, AUTH_FAILED) || has(stderr, HTTP_403))
	)
		return fail(
			"machine-rejected",
			`${host} refused your machine's git${machineDetail(credential.label)}. Sign in again, or add a Git host token.`,
			"add-credential",
		);
	if (source !== "connection" && has(stderr, COULD_NOT_READ_USER))
		return fail(
			"no-credential",
			`No credential for ${host}. Add a Git host token in Settings → Sources, or sign your machine's git in to ${host}.`,
			"add-credential",
		);
	if (source === "machine" && has(stderr, /Host key verification failed/i))
		return fail(
			"ssh-host-key",
			`${host}'s SSH host key is not trusted yet. Run \`ssh -T git@${host}\` once as the user that runs PrismaLens, or use an HTTPS URL with a token.`,
		);
	if (source === "machine" && has(stderr, /Permission denied \(publickey/i))
		return fail(
			"ssh-key-refused",
			`${host} refused your SSH key.${input.sshAuthSockSet ? "" : " No SSH agent is reachable from the server (a background service has none); use an HTTPS URL with a token."}`,
		);
	if (
		source !== "connection" &&
		(has(stderr, REPO_NOT_FOUND) || has(stderr, HTTP_404))
	)
		return fail(
			"not-found",
			`${repo} was not found or is private. Check the URL or add a credential for ${host}.`,
			"add-credential",
		);
	if (has(stderr, UNREACHABLE))
		return fail("unreachable", `Could not reach ${host}.`);
	return fail("other", `git could not read ${repo} on ${host}.`);
}
