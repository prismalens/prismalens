// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";

export interface PermissionCheckResult {
	satisfied: boolean;
	missing: Array<{ key: string; level?: string; reason: string }>;
	extra: string[];
}

/**
 * Compare OAuth granted scopes against the template's requirements.
 *
 * OAuth scopes are flat strings (e.g., "channels:read", "repo").
 * A permission is satisfied if its key exists in the granted scopes.
 */
export function checkOAuthScopes(
	template: AuthTemplate,
	grantedScopes: string[],
): PermissionCheckResult {
	const grantedSet = new Set(grantedScopes);
	const missing: PermissionCheckResult["missing"] = [];
	const requiredKeys = new Set<string>();

	for (const perm of template.requiredPermissions ?? []) {
		requiredKeys.add(perm.key);
		if (!grantedSet.has(perm.key)) {
			missing.push({ key: perm.key, reason: perm.reason });
		}
	}

	const extra = grantedScopes.filter((s) => !requiredKeys.has(s));

	return { satisfied: missing.length === 0, missing, extra };
}
