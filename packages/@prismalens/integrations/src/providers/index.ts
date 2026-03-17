/**
 * Providers — barrel exports + factories
 */

// Shared types
export type { AuthenticatedRequestFn } from "./types.js";

// Git provider
export type {
	GitProvider,
	GitProviderContext,
	GitProviderFactory,
} from "./git.interface.js";
export { GitHubProvider } from "./github/github.provider.js";

// Deployment provider
export type {
	DeploymentProvider,
	DeploymentProviderFactory,
} from "./deployment.interface.js";
export { RenderProvider } from "./render/render.provider.js";
export { VercelProvider } from "./vercel/vercel.provider.js";

// ── Git provider factory ──

import type { GitProvider } from "./git.interface.js";
import { GitHubProvider } from "./github/github.provider.js";

const gitProviders: Record<string, new () => GitProvider> = {
	github: GitHubProvider,
};

export function createGitProvider(providerName: string): GitProvider | null {
	const ProviderClass = gitProviders[providerName.toLowerCase()];
	if (!ProviderClass) return null;
	return new ProviderClass();
}

export function isGitProviderSupported(providerName: string): boolean {
	return providerName.toLowerCase() in gitProviders;
}

export function resolveGitProviderName(templateId: string): string | null {
	if (templateId.startsWith("github")) return "github";
	if (templateId.startsWith("gitlab")) return "gitlab";
	if (templateId.startsWith("bitbucket")) return "bitbucket";
	return null;
}

// ── Deployment provider factory ──

import type { DeploymentProvider } from "./deployment.interface.js";
import { RenderProvider } from "./render/render.provider.js";
import { VercelProvider } from "./vercel/vercel.provider.js";

const deploymentProviders: Record<string, new () => DeploymentProvider> = {
	render: RenderProvider,
	vercel: VercelProvider,
};

export function createDeploymentProvider(
	providerName: string,
): DeploymentProvider | null {
	const ProviderClass = deploymentProviders[providerName.toLowerCase()];
	if (!ProviderClass) return null;
	return new ProviderClass();
}

export function isDeploymentProviderSupported(providerName: string): boolean {
	return providerName.toLowerCase() in deploymentProviders;
}

export function resolveDeploymentProviderName(
	templateId: string,
): string | null {
	if (templateId.startsWith("render")) return "render";
	if (templateId.startsWith("vercel")) return "vercel";
	return null;
}
