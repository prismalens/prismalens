// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SourceCredential } from "@prismalens/contracts/schemas";
import type { CredentialKind } from "../port/credential-kind.js";
import { oauthCredential } from "./oauth.js";
import { oauthClientCredential } from "./oauth-client.js";
import { basic, bearer, header, mtls, none } from "./static.js";

type Kind = SourceCredential["kind"];

/** A vendor MCP sign-in; the proxy drives its refresh through the MCP SDK (#848, 06). */
const mcpOAuth: CredentialKind<"mcp-oauth"> = {
	kind: "mcp-oauth",
	enrol: "sign-in",
	secrets: (c) =>
		[
			c.tokens?.access_token,
			c.tokens?.refresh_token,
			c.client?.client_secret,
		].filter((s): s is string => !!s),
	authorize: async (c) => {
		const headers: Record<string, string> = {};
		if (c.tokens) headers.Authorization = `Bearer ${c.tokens.access_token}`;
		return { headers };
	},
};

const KINDS: { [K in Kind]: CredentialKind<K> } = {
	none,
	bearer,
	basic,
	header,
	mtls,
	oauth: oauthCredential,
	"oauth-client": oauthClientCredential,
	"mcp-oauth": mcpOAuth,
};

export function credentialKind<K extends Kind>(kind: K): CredentialKind<K> {
	return KINDS[kind] as CredentialKind<K>;
}

/** Every secret a credential holds now, including a cached access token. */
export function credentialSecrets(
	c: SourceCredential,
	connectionId = "",
): string[] {
	return (credentialKind(c.kind) as CredentialKind).secrets(c as never, {
		connectionId,
	});
}

export { SignInExpired } from "./errors.js";
export { withConnectionLock } from "./lock.js";
export {
	beginSignIn,
	clientAuthFor,
	completeSignIn,
	forgetOAuthCache,
	httpOptions,
	type OAuthCredential,
	type OAuthHttp,
	oauthKind,
	primeOAuthCache,
	type SignInResult,
	type SignInStart,
	tokenFetch,
} from "./oauth.js";
export { oauthClientKind } from "./oauth-client.js";
