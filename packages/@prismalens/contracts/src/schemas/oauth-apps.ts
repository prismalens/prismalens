// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The PrismaLens-owned OAuth apps (#848). `{}` in git; the release workflow writes the
 * values from repository secrets before `pnpm build`. Public clients (RFC 8252 §8.5).
 */
import generated from "./oauth-apps.generated.json" with { type: "json" };

export const SHIPPED_APP_VENDORS = ["github", "gitlab", "bitbucket"] as const;
export type ShippedAppVendor = (typeof SHIPPED_APP_VENDORS)[number];

export interface ShippedApp {
	clientId: string;
	clientSecret?: string;
}
export type ShippedApps = Partial<Record<ShippedAppVendor, ShippedApp>>;

export const OAUTH_APPS: ShippedApps = generated as ShippedApps;

/** The pinned loopback callback every shipped app registers. */
export const LOOPBACK_PORT = 6474;
export const LOOPBACK_REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;

type OAuthDescriptor = {
	oauth?: {
		authorize: string;
		token: string;
		readScopes: readonly string[];
		scopesBoundGrant: boolean;
		shippedApp?: ShippedAppVendor;
		cloudOrigin?: string;
		selfManaged?: { authorize: string; token: string };
	};
};

/** The authorize and token URLs for a source URL; a "/path" resolves against its origin. */
export function oauthEndpoints(
	d: OAuthDescriptor,
	sourceUrl: string,
): { authorizationUrl: string; tokenUrl: string } | null {
	if (!d.oauth) return null;
	const origin = new URL(sourceUrl).origin;
	const own =
		d.oauth.selfManaged && d.oauth.cloudOrigin && origin !== d.oauth.cloudOrigin
			? d.oauth.selfManaged
			: d.oauth;
	return {
		authorizationUrl: new URL(own.authorize, origin).href,
		tokenUrl: new URL(own.token, origin).href,
	};
}

/** The PrismaLens-owned app, only on the vendor's cloud origin and only when this build ships it. */
export function shippedAppFor(
	d: OAuthDescriptor,
	sourceUrl: string,
	apps: ShippedApps = OAUTH_APPS,
): ShippedApp | null {
	const o = d.oauth;
	if (!o?.shippedApp || !o.cloudOrigin) return null;
	try {
		if (new URL(sourceUrl).origin !== o.cloudOrigin) return null;
	} catch {
		return null;
	}
	return apps[o.shippedApp]?.clientId ? (apps[o.shippedApp] ?? null) : null;
}

export const DISCLOSURE = {
	signIn:
		"This sign-in grants more than PrismaLens uses; what the agent does is governed by the run's permission level.",
	token:
		"This token grants more than PrismaLens uses; what the agent does is governed by the run's permission level.",
} as const;

/**
 * OBJ-013: shown when the grant is not within the read-only scopes, when the provider
 * ignores requested scopes and named none, or when a pasted token's scope is unknown.
 * `granted` is null when the response or token named no scope.
 */
export function needsDisclosure(
	d: OAuthDescriptor,
	granted: readonly string[] | null,
): boolean {
	const read = d.oauth?.readScopes ?? [];
	if (granted === null) return true;
	if (granted.length === 0) return d.oauth?.scopesBoundGrant === false;
	return !granted.every((s) => read.includes(s));
}

/** A token response's `scope`: space-separated per RFC 6749, comma-separated on GitHub. */
export function parseGrantedScopes(scope: unknown): string[] | null {
	if (typeof scope !== "string" || !scope.trim()) return null;
	return scope.split(/[\s,]+/).filter(Boolean);
}
