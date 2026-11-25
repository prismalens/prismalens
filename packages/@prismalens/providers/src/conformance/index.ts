// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, it } from "vitest";
import type { Family, ProviderDef } from "../descriptor.ts";

/** One check every member of a family runs. A member opts out only through a named skip. */
export interface KitCase {
	readonly id: string;
	readonly title: string;
	readonly run: (p: ProviderDef) => void | Promise<void>;
}

/**
 * The family kit: each case over each member, from the registry, never from a list. A member's
 * skip { case: <case id>, reason } turns its case into a skipped test that names the reason.
 */
export function conformance(
	family: Family,
	members: readonly ProviderDef[],
	cases: readonly KitCase[],
): void {
	describe(`${family} conformance`, () => {
		if (members.length === 0)
			it.skip(`skipped: family ${family} has no members yet`, () => {});
		for (const p of members)
			describe(p.id, () => {
				for (const c of cases) {
					const skip = p.skips?.find((s) => s.case === c.id);
					if (skip) it.skip(`${c.title} (skipped: ${skip.reason})`, () => {});
					else it(c.title, () => c.run(p));
				}
			});
	});
}
