// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** OAuth client credentials, for a Bitbucket consumer's key and secret (#848). */
import type { SourceCredential } from "@prismalens/contracts/schemas";
import * as oauth from "oauth4webapi";
import type { CredentialKind } from "../port/credential-kind.js";
import { withConnectionLock } from "./lock.js";
import { clientAuthFor, httpOptions, type OAuthHttp } from "./oauth.js";

type ClientCredential = Extract<SourceCredential, { kind: "oauth-client" }>;

const EARLY_EXPIRY_MS = 60_000;
const cache = new Map<
	string,
	{ key: string; access: string; expiresAt: number }
>();

const keyOf = (c: ClientCredential) =>
	`${c.tokenUrl}\n${c.clientId}\n${c.clientSecret}`;

export function oauthClientKind(
	http: OAuthHttp = {},
): CredentialKind<"oauth-client"> {
	return {
		kind: "oauth-client",
		enrol: "paste",
		secrets: (c, ctx) =>
			[c.clientSecret, cache.get(ctx.connectionId)?.access].filter(
				(s): s is string => !!s,
			),
		authorize: (c, ctx, opts) =>
			withConnectionLock(ctx.connectionId, async () => {
				const hit = cache.get(ctx.connectionId);
				if (
					hit &&
					hit.key === keyOf(c) &&
					hit.expiresAt > Date.now() &&
					hit.access !== opts?.renew?.failedToken
				)
					return { headers: { Authorization: `Bearer ${hit.access}` } };
				const as = {
					issuer: new URL(c.tokenUrl).origin,
					token_endpoint: c.tokenUrl,
				};
				const client: oauth.Client = { client_id: c.clientId };
				const res = await oauth.clientCredentialsGrantRequest(
					as,
					client,
					clientAuthFor(c.tokenUrl, c.clientSecret),
					c.scopes?.length ? { scope: c.scopes.join(" ") } : {},
					httpOptions(http, ctx.signal),
				);
				const t = await oauth.processClientCredentialsResponse(as, client, res);
				cache.set(ctx.connectionId, {
					key: keyOf(c),
					access: t.access_token,
					expiresAt:
						t.expires_in === undefined
							? Number.POSITIVE_INFINITY
							: Date.now() + t.expires_in * 1000 - EARLY_EXPIRY_MS,
				});
				return { headers: { Authorization: `Bearer ${t.access_token}` } };
			}),
	};
}

export const oauthClientCredential = oauthClientKind();
