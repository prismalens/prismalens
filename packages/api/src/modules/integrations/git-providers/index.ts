/**
 * Git Providers Module
 *
 * Factory and exports for git provider implementations.
 * Add new providers here as they are implemented.
 */

export * from './git-provider.interface.js';
export * from './github.provider.js';

import type { GitProvider } from './git-provider.interface.js';
import { GitHubProvider } from './github.provider.js';

/**
 * Map of provider names to their implementations.
 * Add new providers here as they are implemented.
 */
const providers: Record<string, new () => GitProvider> = {
  github: GitHubProvider,
  // Future providers:
  // gitlab: GitLabProvider,
  // bitbucket: BitBucketProvider,
};

/**
 * Create a git provider instance by name.
 * Returns null if the provider is not supported.
 *
 * @param providerName - Name of the provider (e.g., "github", "gitlab")
 * @returns GitProvider instance or null
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
 *
 * @param providerName - Name of the provider
 * @returns true if the provider is supported
 */
export function isGitProviderSupported(providerName: string): boolean {
  return providerName.toLowerCase() in providers;
}

/**
 * Get list of supported provider names.
 *
 * @returns Array of supported provider names
 */
function getSupportedGitProviders(): string[] {
  return Object.keys(providers);
}

// Reserved for future use
void getSupportedGitProviders;
