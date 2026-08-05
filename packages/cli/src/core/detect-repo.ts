// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Resolve the repository label under investigation. Precedence: an explicit
 * config `repo` value (owner/name) wins; else git origin auto-detect from the
 * working directory; else `undefined`.
 *
 * The git-origin detection itself lives in `@prismalens/config` alongside the
 * app's checkout validation (#331) — D11's no-new-divergence rule: the CLI and
 * the app must agree on what a checkout is and what its slug is, so there is
 * one implementation and this module delegates to it.
 */
import { detectRepoSlug } from "@prismalens/config";

/** Session repo label: an explicit config `repo` (owner/name) wins; else git
 * auto-detect from cwd; else none. */
export async function resolveRepoSlug(
	configRepo: string | undefined,
	cwd: string = process.cwd(),
): Promise<string | undefined> {
	return configRepo ?? (await detectRepoSlug(cwd));
}
