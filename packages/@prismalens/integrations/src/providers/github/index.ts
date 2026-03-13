/**
 * Providers — GitHub
 *
 * Factory and exports for the GitHub provider implementation.
 */

export type {
	AuthenticatedRequestFn,
	GitProvider,
	GitProviderContext,
	GitProviderFactory,
} from "./provider.interface.js";
export { GitHubProvider } from "./github.provider.js";

import type { GitProvider } from "./provider.interface.js";
import { GitHubProvider } from "./github.provider.js";

const providers: Record<string, new () => GitProvider> = {
	github: GitHubProvider,
};

/**
 * Create a git provider instance by name.
 * Returns null if the provider is not supported.
 */
export function createGitProvider(providerName: string): GitProvider | null {
	const ProviderClass = providers[providerName.toLowerCase()];
	if (!ProviderClass) {
		return null;
	}
	return new ProviderClass();
}

/**
 * Check if a provider is supported.
 */
export function isGitProviderSupported(providerName: string): boolean {
	return providerName.toLowerCase() in providers;
}

/**
 * Resolve a git provider name from a template ID.
 * Returns null if the template doesn't map to a known git provider.
 */
export function resolveGitProviderName(templateId: string): string | null {
	if (templateId.startsWith("github")) return "github";
	if (templateId.startsWith("gitlab")) return "gitlab";
	if (templateId.startsWith("bitbucket")) return "bitbucket";
	return null;
}
