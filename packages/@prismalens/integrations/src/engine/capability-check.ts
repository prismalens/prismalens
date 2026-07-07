// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Capability } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

/**
 * Error thrown when a template does not support a required capability.
 */
export class CapabilityNotSupportedError extends Error {
	constructor(
		public readonly templateId: string,
		public readonly capability: Capability,
	) {
		super(
			`Template "${templateId}" does not support capability "${capability}"`,
		);
		this.name = "CapabilityNotSupportedError";
	}
}

/**
 * Derive all capabilities from a template's requiredPermissions.
 */
export function getCapabilities(template: AuthTemplate): Capability[] {
	if (!template.requiredPermissions) return [];
	const set = new Set<Capability>();
	for (const perm of template.requiredPermissions) {
		for (const cap of perm.capabilities) {
			set.add(cap);
		}
	}
	return Array.from(set);
}

/**
 * Check if a template supports a given capability.
 */
export function hasCapability(
	template: AuthTemplate,
	capability: Capability,
): boolean {
	return getCapabilities(template).includes(capability);
}

/**
 * Assert that a template supports a capability.
 * Throws CapabilityNotSupportedError if not.
 */
export function assertCapability(
	template: AuthTemplate,
	capability: Capability,
): void {
	if (!hasCapability(template, capability)) {
		throw new CapabilityNotSupportedError(template.id, capability);
	}
}
