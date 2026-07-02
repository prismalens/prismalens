import type { AuthTemplate } from "../types.js";

export interface PermissionCheckResult {
	satisfied: boolean;
	missing: Array<{ key: string; level?: string; reason: string }>;
	extra: string[];
}

/**
 * Compare a GitHub App installation's granted permissions against the template's requirements.
 *
 * GitHub App permissions are key-value pairs like { contents: "read", metadata: "read" }.
 * A permission is satisfied if the granted level is >= the required level.
 */
export function checkGitHubAppPermissions(
	template: AuthTemplate,
	grantedPermissions: Record<string, string>,
): PermissionCheckResult {
	const levelOrder: Record<string, number> = {
		read: 1,
		write: 2,
		admin: 3,
	};

	const missing: PermissionCheckResult["missing"] = [];
	const requiredKeys = new Set<string>();

	for (const perm of template.requiredPermissions ?? []) {
		requiredKeys.add(perm.key);
		const granted = grantedPermissions[perm.key];
		const requiredLevel = perm.level ?? "read";

		if (!granted) {
			missing.push({
				key: perm.key,
				level: requiredLevel,
				reason: perm.reason,
			});
		} else if ((levelOrder[granted] ?? 0) < (levelOrder[requiredLevel] ?? 0)) {
			missing.push({
				key: perm.key,
				level: requiredLevel,
				reason: `${perm.reason} (granted "${granted}", need "${requiredLevel}")`,
			});
		}
	}

	const extra = Object.keys(grantedPermissions).filter(
		(k) => !requiredKeys.has(k),
	);

	return { satisfied: missing.length === 0, missing, extra };
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
