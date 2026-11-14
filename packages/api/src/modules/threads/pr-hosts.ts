// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What a git host says about one change request (#1024), read through its
 * adapter in `code-hosts/` (#1122). Every read is conditional on the ETag the
 * last one got. Image URLs are stored, never fetched here.
 */
import type { PrReviewThread } from "@prismalens/contracts";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import type { CodeHostKind } from "./code-hosts/adapter.js";
import type { EtagCache, PrActivityItem } from "./code-hosts/common.js";
import { CODE_HOSTS } from "./code-hosts/registry.js";

export type {
	CheckLogAccess,
	CodeHostAdapter,
	CodeHostKind,
} from "./code-hosts/adapter.js";
export {
	type CheckLogRead,
	type EtagCache,
	type HeadRead,
	type HostRead,
	HostReadError,
	imageUrl,
	LOG_TAIL_LINES,
	LOG_UNAVAILABLE,
	type LogLocate,
	logTail,
	type PrActivityItem,
	readLogEnd,
} from "./code-hosts/common.js";
export { readGithub, readGithubCheckLog } from "./code-hosts/github.js";
export { readGitlab, readGitlabJobLog } from "./code-hosts/gitlab.js";
export { CODE_HOSTS, codeHost } from "./code-hosts/registry.js";

/** New reviews and comments on a change request, oldest first, from its host's adapter. */
export function readActivity(
	req: AuthenticatedRequestFn,
	kind: CodeHostKind,
	repo: string,
	number: number,
	cache: EtagCache,
): Promise<PrActivityItem[]> {
	return CODE_HOSTS[kind].readActivity(req, repo, number, cache);
}

/** A change request's review threads with their resolved state (#1101 category 15). */
export function readReviewThreads(
	req: AuthenticatedRequestFn,
	kind: CodeHostKind,
	repo: string,
	number: number,
	/** The API origin `req` is bound to, where a host serves threads beside it. */
	apiBase?: string,
): Promise<PrReviewThread[]> {
	return CODE_HOSTS[kind].readReviewThreads(req, repo, number, apiBase);
}
