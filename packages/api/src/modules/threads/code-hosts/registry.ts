// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrHost } from "@prismalens/contracts";
import type { CodeHostAdapter, CodeHostKind } from "./adapter.js";
import { github } from "./github.js";
import { gitlab } from "./gitlab.js";

/**
 * Every code host PrismaLens reads, by kind (#1122). A new host is one adapter
 * file, one line here and its terms in the contract's `PR_HOST_TERMS`, and it runs
 * through `adapters.contract.spec.ts` with its own fixtures. Order is URL-match order.
 */
export const CODE_HOSTS: Readonly<Record<CodeHostKind, CodeHostAdapter>> = {
	gitlab,
	github,
};

/** The adapter for a host kind; null for a link PrismaLens shows but cannot read. */
export function codeHost(
	kind: PrHost | string | null | undefined,
): CodeHostAdapter | null {
	return kind && Object.hasOwn(CODE_HOSTS, kind)
		? CODE_HOSTS[kind as CodeHostKind]
		: null;
}
