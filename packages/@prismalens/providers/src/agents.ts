// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type AgentDef, isAgent } from "./agent/family.ts";
import type { ProviderDef } from "./descriptor.ts";
import { builtIn } from "./registry.gen.ts";

/**
 * The built-in agents in their declared order, read from the generated barrel without the
 * ProviderRegistry, so the UI's first paint carries the descriptors and not the registry (#1082).
 */
export const agents = (): AgentDef[] =>
	Object.values(builtIn)
		.flatMap((mod) => Object.values(mod) as ProviderDef[])
		.filter((p) => p.kind === "provider" && isAgent(p))
		.map((p) => p as AgentDef)
		.sort((a, b) => a.order - b.order);

/** The agent family's types and helpers, for a reader that needs no registry. */
export * from "./agent/family.ts";
