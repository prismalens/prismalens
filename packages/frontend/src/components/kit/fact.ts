// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { FactId } from "@/registry/closed/fact";

export type { FactId };

/**
 * Marks an element as showing one fact from `registry/closed/fact.ts`, so the evidence run
 * can count a fact shown twice on one screen (#1101). Spread it: `<span {...fact("title")}>`.
 */
export const fact = (id: FactId | undefined) =>
	id ? ({ "data-fact": id } as const) : {};
