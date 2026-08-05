// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Extract service label from an alert object (service, namespace, or job).
 */
export function pickServiceLabel(
	alert: Record<string, unknown> | undefined,
): string | undefined {
	if (!alert) return undefined;
	const labels = (alert.labels ?? {}) as Record<string, unknown>;
	const pick = labels.service ?? labels.namespace ?? labels.job;
	return typeof pick === "string" && pick ? pick : undefined;
}

/**
 * Per-alert repo/cwd resolution: alert's service label → config.services[name].repo
 * → config.repos[repoRef].local_path, else repoRef if existing local checkout.
 */
export function resolveRepoPath(
	alert: Record<string, unknown>,
	config: {
		services?: Record<string, { repo?: string }>;
		repos?: Record<string, { local_path?: string | null }>;
	},
): string {
	const name = pickServiceLabel(alert);
	if (!name) {
		throw new Error(
			"Listen dispatch refused: alert is missing a service label (cannot resolve an investigation workspace).",
		);
	}
	const repoRef = config.services?.[name]?.repo;
	if (!repoRef) {
		throw new Error(
			`Listen dispatch refused: service "${name}" has no mapped repo in config (cannot resolve an investigation workspace).`,
		);
	}
	const localPath = config.repos?.[repoRef]?.local_path;
	if (localPath) return resolve(localPath);
	if (existsSync(repoRef)) return resolve(repoRef);
	throw new Error(
		`Listen dispatch refused: repo "${repoRef}" (mapped from service "${name}") does not exist locally (cannot resolve an investigation workspace).`,
	);
}

// =============================================================================
// LOCAL CHECKOUT MAPPING (#331)
//
// The app's Service → local-checkout mapping and the CLI's
// `services[name].repo` → `repos[ref].local_path` chain resolve to the SAME
// thing: an absolute directory on this machine that an investigation runs in.
// D11's no-new-divergence rule says there is exactly one implementation of
// "is this a usable checkout?" and one of "which directory does this run get?" —
// they live here, and `packages/cli/src/core/detect-repo.ts` delegates to the
// slug detector rather than carrying a second copy of it.
// =============================================================================

const REPO_SLUG_PATTERN =
	/(?:github\.com|gitlab\.com|bitbucket\.org)[/:](.+?)(?:\.git)?$/;

/**
 * `owner/name` for the checkout at `cwd`, read from its `origin` remote.
 * `undefined` when the directory is not a git repo, has no origin, or the
 * origin URL is not from a recognised forge.
 */
export async function detectRepoSlug(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["remote", "get-url", "origin"],
			{ cwd },
		);
		return stdout.trim().match(REPO_SLUG_PATTERN)?.[1];
	} catch {
		return undefined;
	}
}

/** Why a candidate checkout path was refused. */
export type CheckoutRejection =
	| "empty"
	| "not_absolute"
	| "not_found"
	| "not_a_directory"
	| "not_a_git_repo";

export interface CheckoutValidation {
	valid: boolean;
	/** The normalised absolute path the caller should persist. */
	path: string;
	reason?: CheckoutRejection;
	/** Operator-facing sentence; safe to render verbatim in the UI. */
	message?: string;
	/** Root of the enclosing git work tree (set only when `valid`). */
	repoRoot?: string;
	/** `owner/name` from the origin remote, when detectable. */
	repoSlug?: string;
	/** True when `path` is a subdirectory of `repoRoot` (monorepo package). */
	isSubdirectory?: boolean;
}

/**
 * Normalise a user-supplied checkout path: trim, expand a leading `~`, and
 * resolve to an absolute path. Returns the empty string for blank input.
 */
export function normalizeCheckoutPath(raw: string | null | undefined): string {
	const trimmed = (raw ?? "").trim();
	if (!trimmed) return "";
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
	if (!isAbsolute(trimmed)) return trimmed;
	return resolve(trimmed);
}

/**
 * Validate a candidate local checkout AT CONFIGURATION TIME — the whole point
 * is that a bad path fails here, with a sentence the operator can act on,
 * rather than three minutes into an investigation that read the wrong tree.
 *
 * Accepts a subdirectory of a work tree (monorepo packages are a real mapping),
 * and reports the enclosing root so the UI can say which repo was recognised.
 */
export async function validateLocalCheckout(
	raw: string | null | undefined,
): Promise<CheckoutValidation> {
	const path = normalizeCheckoutPath(raw);
	if (!path) {
		return {
			valid: false,
			path: "",
			reason: "empty",
			message: "Enter a path to the local checkout.",
		};
	}
	if (!isAbsolute(path)) {
		return {
			valid: false,
			path,
			reason: "not_absolute",
			message: `"${path}" is not an absolute path. Use a full path such as /home/you/code/checkout.`,
		};
	}
	let isDirectory: boolean;
	try {
		isDirectory = statSync(path).isDirectory();
	} catch {
		return {
			valid: false,
			path,
			reason: "not_found",
			message: `"${path}" does not exist on this machine.`,
		};
	}
	if (!isDirectory) {
		return {
			valid: false,
			path,
			reason: "not_a_directory",
			message: `"${path}" is a file, not a directory.`,
		};
	}
	let repoRoot: string;
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--show-toplevel"],
			{ cwd: path },
		);
		repoRoot = resolve(stdout.trim());
	} catch {
		return {
			valid: false,
			path,
			reason: "not_a_git_repo",
			message: `"${path}" is not a git checkout (no repository found at or above it).`,
		};
	}
	const repoSlug = await detectRepoSlug(path);
	return {
		valid: true,
		path,
		repoRoot,
		...(repoSlug ? { repoSlug } : {}),
		isSubdirectory: repoRoot !== path,
	};
}

/** Which layer supplied the directory an investigation ran in. */
export type InvestigationCwdSource =
	| "service-mapping"
	| "env-override"
	| "worker-cwd";

export interface InvestigationCwdResolution {
	cwd: string;
	source: InvestigationCwdSource;
	/** True only when a Service→checkout mapping supplied the directory. */
	mapped: boolean;
	/** Operator-facing sentence for the run report / timeline. */
	note: string;
}

/**
 * Resolve the working directory for ONE investigation. Precedence:
 *
 *   1. the incident's Service → `localCheckoutPath` mapping (per-investigation);
 *   2. `PRISMALENS_INVESTIGATION_CWD` — demoted from primary to an escape hatch
 *      for unmapped services (#331);
 *   3. the worker's own cwd — the honest last resort.
 *
 * Levels 2 and 3 are UNMAPPED: the returned `note` says so in words, because a
 * run against the wrong directory produces confident garbage and the report has
 * to admit which directory it read.
 */
export function resolveInvestigationCwd(input: {
	mappedPath?: string | null;
	serviceName?: string | null;
	envOverride?: string | null;
	fallbackCwd?: string;
}): InvestigationCwdResolution {
	const service = input.serviceName?.trim();
	const mapped = normalizeCheckoutPath(input.mappedPath);
	if (mapped) {
		return {
			cwd: mapped,
			source: "service-mapping",
			mapped: true,
			note: service
				? `Investigating in ${mapped} — the local checkout mapped to service "${service}".`
				: `Investigating in ${mapped} — the mapped local checkout.`,
		};
	}
	const unmappedService = service
		? `service "${service}" has no local checkout mapped`
		: "this incident has no service with a local checkout mapped";
	const override = input.envOverride?.trim();
	if (override) {
		return {
			cwd: override,
			source: "env-override",
			mapped: false,
			note: `Ran UNMAPPED in ${override} — ${unmappedService}; fell back to PRISMALENS_INVESTIGATION_CWD. Findings may not describe the code that alerted.`,
		};
	}
	const fallback = input.fallbackCwd ?? process.cwd();
	return {
		cwd: fallback,
		source: "worker-cwd",
		mapped: false,
		note: `Ran UNMAPPED in ${fallback} — ${unmappedService}; fell back to the worker's own working directory. Findings may not describe the code that alerted.`,
	};
}
