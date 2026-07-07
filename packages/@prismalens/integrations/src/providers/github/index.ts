// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Providers — GitHub
 *
 * Re-exports for backward compatibility.
 * Canonical locations: ../types.ts, ../git.interface.ts
 */

export type {
	GitProvider,
	GitProviderContext,
	GitProviderFactory,
} from "../git.interface.js";
export {
	createGitProvider,
	isGitProviderSupported,
	resolveGitProviderName,
} from "../index.js";
export type { AuthenticatedRequestFn } from "../types.js";
export { GitHubProvider } from "./github.provider.js";
