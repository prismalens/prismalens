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

/** A git call that failed, in words the user can act on. `stderr` is scrubbed and for the server log only. */
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

/** Strips anything that looks like a credential from git's stderr. */
export function scrubGitStderr(stderr: string): string {
	return stderr
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
	return label.replace(/^token /, "");
}

/** `(gh, sumit)` from `machine git (gh, sumit)`, or "" when the label has none. */
function machineDetail(label: string): string {
	const m = /\(([^)]*)\)\s*$/.exec(label);
	return m ? ` (${m[1]})` : "";
}

export function formatDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** git's own message prefixes under `LC_ALL=C`, matched in table order (plan §1.4, #673). */
export function diagnoseGitFailure(input: DiagnoseInput): GitFailure {
	const { credential, host, repo } = input;
	const stderr = scrubGitStderr(input.stderr);
	const first =
		stderr
			.split("\n")
			.find((l) => l.trim())
			?.trim() ?? "git failed";
	const token = tokenName(credential.label);
	const fp = credential.fingerprint ? ` (fp ${credential.fingerprint})` : "";
	const fail = (
		code: GitFailureCode,
		message: string,
		action?: GitFailureAction,
	) => new GitFailure(code, message, action, stderr);
	const source = credential.source;
	const now = input.now ?? new Date();

	if (
		source === "connection" &&
		input.tokenExpiresAt &&
		input.tokenExpiresAt < now
	)
		return fail(
			"token-expired",
			`Token "${token}" expired on ${formatDay(input.tokenExpiresAt)}. Replace it in Settings → Integrations.`,
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
			`No credential for ${host}. Add a Git host token in Settings → Integrations, or sign your machine's git in to ${host}.`,
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
		return fail("unreachable", `Could not reach ${host}: ${first}.`);
	return fail("other", first);
}
