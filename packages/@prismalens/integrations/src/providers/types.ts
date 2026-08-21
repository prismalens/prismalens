// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Shared provider types
 *
 * AuthenticatedRequestFn is the core abstraction — providers never see raw tokens.
 * AuthManager.request() is bound to a connectionId and injected as this function.
 */

import type { DeploymentProvider } from "./deployment.interface.js";
import type { GitProvider } from "./git.interface.js";

/**
 * Bound authenticated request function — created by binding
 * AuthManager.request() to a specific connectionId.
 */
export type AuthenticatedRequestFn = (
	method: string,
	path: string,
	options?: { body?: string; headers?: Record<string, string> },
) => Promise<Response>;

/** Segment kind supported by adapters (#446: vcs and deployment only). */
export type SegmentKind = "vcs" | "deployment";

/**
 * Provider adapter interface (#446).
 * One adapter class per vendor, exposing optional per-kind segments.
 * Capabilities are derived from segment presence — never declared separately.
 */
export interface ProviderAdapter {
	readonly name: string;
	readonly vcs?: GitProvider;
	readonly deployment?: DeploymentProvider;
}

export type ProviderAdapterFactory = (
	templateId: string,
) => ProviderAdapter | null;
