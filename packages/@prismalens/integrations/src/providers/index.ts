// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Providers — unified exact-templateId registry and segmented adapters (#446)
 */

import { GitHubAdapter } from "./github/github.adapter.js";
import { PrometheusAdapter } from "./prometheus/prometheus.adapter.js";
import { RenderAdapter } from "./render/render.adapter.js";
import type { ProviderAdapter, SegmentKind } from "./types.js";

// Deployment provider
export type { DeploymentProvider } from "./deployment.interface.js";
// Git provider
export type {
	GitProvider,
	GitProviderContext,
} from "./git.interface.js";
export {
	GitHubAdapter,
	GitHubDeploymentsSegment,
	GitHubVcsSegment,
} from "./github/index.js";
// Metrics provider (#633)
export {
	type AlertRule,
	type InstantSample,
	type MetricsQueries,
	type QueryBudget,
	QueryBudgetExceededError,
	type RangeSeries,
} from "./metrics.interface.js";
export {
	PrometheusAdapter,
	PrometheusMetricsSegment,
} from "./prometheus/index.js";
export { RenderAdapter, RenderDeploymentSegment } from "./render/index.js";
// Shared provider and adapter types
export type {
	AuthenticatedRequestFn,
	ProviderAdapter,
	ProviderAdapterFactory,
	SegmentKind,
} from "./types.js";

// ── Exact-templateId adapter registry ──

const ADAPTER_REGISTRY: Record<string, new () => ProviderAdapter> = {
	"github-token": GitHubAdapter,
	prometheus: PrometheusAdapter,
	render: RenderAdapter,
};

/** Create an adapter instance for an exact templateId (#446). */
export function createAdapter(templateId: string): ProviderAdapter | null {
	const AdapterClass = ADAPTER_REGISTRY[templateId];
	if (!AdapterClass) return null;
	return new AdapterClass();
}

export const getAdapter = createAdapter;

/** Register a connector under its templateId; throws when the id is taken. The returned function removes it (#855). */
export function registerAdapter(
	templateId: string,
	AdapterClass: new () => ProviderAdapter,
): () => void {
	if (templateId in ADAPTER_REGISTRY)
		throw new Error(`An adapter is already registered for '${templateId}'`);
	ADAPTER_REGISTRY[templateId] = AdapterClass;
	return () => {
		delete ADAPTER_REGISTRY[templateId];
	};
}

/** The first registered adapter whose deployment pulls the deploys of repositories on `host` (#855). */
export function findDeploymentAdapterForHost(
	host: string,
): ProviderAdapter | null {
	for (const AdapterClass of Object.values(ADAPTER_REGISTRY)) {
		const adapter = new AdapterClass();
		if (adapter.deployment?.servesHost?.(host)) return adapter;
	}
	return null;
}

/** Check if an exact templateId has a registered adapter (#446). */
export function isAdapterSupported(templateId: string): boolean {
	return templateId in ADAPTER_REGISTRY;
}

/** Return all templateIds registered in ADAPTER_REGISTRY (#446). */
export function getRegisteredTemplateIds(): string[] {
	return Object.keys(ADAPTER_REGISTRY);
}

/** Derive segment kinds from adapter segment presence (#446, #633). */
export function getAdapterSegments(adapter: ProviderAdapter): SegmentKind[] {
	const segments: SegmentKind[] = [];
	if (adapter.vcs) segments.push("vcs");
	if (adapter.deployment) segments.push("deployment");
	if (adapter.metrics) segments.push("metrics");
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
