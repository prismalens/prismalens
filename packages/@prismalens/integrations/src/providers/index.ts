// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Providers — unified exact-templateId registry and segmented adapters (#446)
 */

import { GitHubAdapter } from "./github/github.adapter.js";
import { RenderAdapter } from "./render/render.adapter.js";
import type { ProviderAdapter, SegmentKind } from "./types.js";
import { VercelAdapter } from "./vercel/vercel.adapter.js";

// Deployment provider
export type { DeploymentProvider } from "./deployment.interface.js";
// Git provider
export type {
	GitProvider,
	GitProviderContext,
} from "./git.interface.js";
export { GitHubAdapter, GitHubVcsSegment } from "./github/index.js";
export { RenderAdapter, RenderDeploymentSegment } from "./render/index.js";
// Shared provider and adapter types
export type {
	AuthenticatedRequestFn,
	ProviderAdapter,
	ProviderAdapterFactory,
	SegmentKind,
} from "./types.js";
export { VercelAdapter, VercelDeploymentSegment } from "./vercel/index.js";

// ── Exact-templateId adapter registry ──

const ADAPTER_REGISTRY: Record<string, new () => ProviderAdapter> = {
	"github-app": GitHubAdapter,
	"github-token": GitHubAdapter,
	render: RenderAdapter,
	vercel: VercelAdapter,
};

/** Create an adapter instance for an exact templateId (#446). */
export function createAdapter(templateId: string): ProviderAdapter | null {
	const AdapterClass = ADAPTER_REGISTRY[templateId];
	if (!AdapterClass) return null;
	return new AdapterClass();
}

export const getAdapter = createAdapter;

/** Check if an exact templateId has a registered adapter (#446). */
export function isAdapterSupported(templateId: string): boolean {
	return templateId in ADAPTER_REGISTRY;
}

/** Return all templateIds registered in ADAPTER_REGISTRY (#446). */
export function getRegisteredTemplateIds(): string[] {
	return Object.keys(ADAPTER_REGISTRY);
}

/** Derive segment kinds from adapter segment presence (#446). */
export function getAdapterSegments(adapter: ProviderAdapter): SegmentKind[] {
	const segments: SegmentKind[] = [];
	if (adapter.vcs) segments.push("vcs");
	if (adapter.deployment) segments.push("deployment");
	return segments;
}

export const adapterSegments = getAdapterSegments;

/** Return templateIds providing a given segment kind (#446). */
export function getTemplatesForSegment(segment: SegmentKind): string[] {
	const result: string[] = [];
	for (const [templateId, AdapterClass] of Object.entries(ADAPTER_REGISTRY)) {
		const adapter = new AdapterClass();
		if (adapter[segment]) {
			result.push(templateId);
		}
	}
	return result;
}

export const templatesForSegment = getTemplatesForSegment;
