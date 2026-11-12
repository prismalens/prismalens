// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckRun,
	PrHost,
	PrHostTerms,
	PrReviewThread,
} from "@prismalens/contracts";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import type {
	CheckLogRead,
	EtagCache,
	HostRead,
	LogLocate,
	PrActivityItem,
} from "./common.js";

/** A host kind that has an adapter; `other` is a link PrismaLens shows but never reads. */
export type CodeHostKind = Exclude<PrHost, "other">;

/** What a log read may call beyond the API: the redirect probe and the signed download. */
export interface CheckLogAccess {
	req: AuthenticatedRequestFn;
	/** The API origin `req` is bound to. */
	apiBase: string;
	locate: LogLocate;
	/** Fetches a host-signed log address; no credential goes with it. */
	download: (url: string) => Promise<Response>;
}

/**
 * One git host behind the change-request model (#1122). Every read goes through
 * `req`, already bound to the host's fixed API origin with the repository's credential.
 */
export interface CodeHostAdapter {
	readonly kind: CodeHostKind;
	/** The host's own words; the UI renders these from the contract, never its own. */
	readonly terms: PrHostTerms;
	/** The API origin for a web host, from a fixed mapping, never from a URL's path. */
	apiBase(host: string): string;
	/** A change request's repo path and number from its web URL's path segments; null when not this host's. */
	parsePath(
		parts: string[],
	): { repoParts: string[]; number: string | undefined } | null;
	/** The web URL's path after the repo, so stored and compared URLs agree. */
	webPath(number: number): string;
	/** The change request: state, review, checks or pipeline jobs, conflicts and detail. */
	read(
		req: AuthenticatedRequestFn,
		repo: string,
		number: number,
		cache: EtagCache,
	): Promise<HostRead>;
	/** Reviews and comments, oldest first, for the status feed. */
	readActivity(
		req: AuthenticatedRequestFn,
		repo: string,
		number: number,
		cache: EtagCache,
	): Promise<PrActivityItem[]>;
	/** Review threads with their resolved state. */
	readReviewThreads(
		req: AuthenticatedRequestFn,
		repo: string,
		number: number,
		apiBase?: string,
	): Promise<PrReviewThread[]>;
	/** One check's or job's failing step and log tail, or why there is none. */
	readCheckLog(
		access: CheckLogAccess,
		repo: string,
		run: PrCheckRun,
	): Promise<CheckLogRead>;
	/** The newest change request whose source is `branch`, as its web URL. */
	findByBranch(
		req: AuthenticatedRequestFn,
		repo: string,
		branch: string,
	): Promise<string | null>;
}
