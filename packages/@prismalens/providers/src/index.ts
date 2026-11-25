// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export {
	type AccessLevel,
	type AgentDef,
	type AgentFacts,
	type AgentSpec,
	type CatalogueSource,
	type CheckedModes,
	defineAgent,
	type InstallChannel,
	installCommand,
	isAgent,
	type Lines,
	modeNamed,
	noModeLines,
	offers,
} from "./agent/family.ts";
export {
	type AuthApply,
	type AuthScheme,
	defineEntryPoint,
	defineProvider,
	type EntryPointDef,
	type EntryPointSpec,
	FAMILIES,
	type Family,
	isSecret,
	type Operation,
	type ProviderDef,
	type ProviderSpec,
	type SignInMethod,
	type Skip,
	type StoredId,
	secret,
	secretFields,
} from "./descriptor.ts";
export {
	type ProviderId,
	type ProviderIdMap,
	ProviderRegistry,
	type Resolved,
} from "./registry.ts";

import { isAgent } from "./agent/family.ts";
import { builtIn } from "./registry.gen.ts";
import { ProviderRegistry } from "./registry.ts";

/** The built-in members; a module's members join through `contribute`. */
export const providers = new ProviderRegistry(builtIn);

/** The built-in agents in their declared order. */
export const agents = () => providers.list("agent").filter(isAgent);
