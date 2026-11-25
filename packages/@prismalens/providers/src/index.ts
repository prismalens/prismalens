// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
