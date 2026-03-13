/**
 * Providers — GitHub
 *
 * Re-exports for backward compatibility.
 * Canonical locations: ../types.ts, ../git.interface.ts
 */

export type { AuthenticatedRequestFn } from "../types.js";
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
export { GitHubProvider } from "./github.provider.js";
