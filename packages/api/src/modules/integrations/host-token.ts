// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SourceCredential } from "@prismalens/contracts/schemas";
import type { Connection, Integration } from "@prismalens/database";
import { getTemplate } from "@prismalens/integrations";
import {
	hostFromApiBaseUrl,
	hostFromGithubBaseUrl,
	normalizeGitHost,
	tokenFrom,
	tokenUsernameFor,
} from "../../core/harness/git-credential.js";
import type { CredentialsService } from "./crypto/credentials.service.js";
import { readStored, type Stored } from "./stored-credential.js";

/** A saved git host token, decrypted. `token` never reaches a response or a log. */
export interface HostToken {
	connectionId: string;
	label: string;
	templateId: string;
	host: string;
	token: string;
	/** The basic-auth user git sends beside it. */
	username: string;
	fingerprint: string;
	status: string;
	tokenExpiresAt: Date | null;
	lastErrorMessage: string | null;
}

/** A git host template: Test and the resolver treat its rows as clone credentials. */
export function isGitHostTemplate(templateId: string): boolean {
	return getTemplate(templateId)?.gitHost === true;
}

const TEMPLATE_USERNAME: Record<string, string> = {
	"github-token": "x-access-token",
	"gitlab-token": "oauth2",
	"bitbucket-token": "x-token-auth",
};

type Row = Connection & { integration: Integration };

interface Decoded {
	host: string;
	stored: Stored;
	blob: Record<string, unknown>;
	/** What the fingerprint is taken over: the token, or the sign-in's long-lived secret. */
	identity: string;
}

function decode(conn: Row, credentials: CredentialsService): Decoded | null {
	if (!isGitHostTemplate(conn.integration.templateId)) return null;
	let blob: Record<string, unknown> = {};
	let config: Record<string, unknown> = {};
	try {
		blob = credentials.decrypt<Record<string, unknown>>(
			Buffer.from(conn.credentialsEnc),
		);
		if (conn.connectionConfigEnc)
			config = credentials.decrypt<Record<string, unknown>>(
				Buffer.from(conn.connectionConfigEnc),
			);
	} catch {
		return null;
	}
	const templateId = conn.integration.templateId;
	const stored = readStored(templateId, blob);
	const baseUrl = stored.baseUrl ?? config.baseUrl;
	const host =
		templateId === "github-token"
			? hostFromGithubBaseUrl(baseUrl)
			: templateId === "gitlab-token"
				? (hostFromApiBaseUrl(baseUrl) ?? "gitlab.com")
				: templateId === "bitbucket-token"
					? (hostFromApiBaseUrl(baseUrl) ?? "bitbucket.org")
					: normalizeGitHost(
							typeof config.host === "string" ? config.host : "",
						);
	const c = stored.credential.ok ? stored.credential.credential : null;
	const identity =
		c?.kind === "oauth"
			? (c.refreshToken ?? c.accessToken ?? null)
			: c?.kind === "oauth-client"
				? `${c.clientId}:${c.clientSecret}`
				: tokenFrom(blob);
	if (!host || !identity) return null;
	return { host, stored, blob, identity };
}

/** Host and fingerprint for Settings; no token is resolved. */
export function hostTokenInfo(
	conn: Row,
	credentials: CredentialsService,
): { host: string; fingerprint: string } | null {
	const d = decode(conn, credentials);
	return d
		? {
				host: d.host,
				fingerprint: credentials
					.getVault()
					.hmacHex(`${d.host}:${d.identity}`)
					.slice(0, 8),
			}
		: null;
}

/** Resolves a sign-in's current access token; a pasted token passes through. */
export type AuthorizeHost = (
	connectionId: string,
	credential: SourceCredential,
) => Promise<string | null>;

/** The host and token a git host connection holds, or null when it holds none. */
export async function readHostToken(
	conn: Row,
	credentials: CredentialsService,
	authorize?: AuthorizeHost,
): Promise<HostToken | null> {
	const d = decode(conn, credentials);
	if (!d) return null;
	const c = d.stored.credential.ok ? d.stored.credential.credential : null;
	const signedIn = c?.kind === "oauth" || c?.kind === "oauth-client";
	let token: string | null;
	try {
		token =
			signedIn && c
				? ((await authorize?.(conn.id, c)) ?? null)
				: tokenFrom(d.blob);
	} catch {
		token = null;
	}
	if (!token) return null;
	return {
		connectionId: conn.id,
		label: conn.label || conn.integration.label,
		templateId: conn.integration.templateId,
		host: d.host,
		token,
		username:
			TEMPLATE_USERNAME[conn.integration.templateId] ??
			tokenUsernameFor(d.host.replace(/:\d+$/, "")),
		fingerprint: credentials
			.getVault()
			.hmacHex(`${d.host}:${d.identity}`)
			.slice(0, 8),
		status: conn.status,
		tokenExpiresAt: conn.tokenExpiresAt,
		lastErrorMessage: conn.lastErrorMessage,
	};
}

/** `metadata.credentialConnectionId` of a repository row. */
export function pickOf(metadata: unknown): string | null {
	let value: unknown = metadata;
	if (typeof metadata === "string") {
		try {
			value = JSON.parse(metadata);
		} catch {
			return null;
		}
	}
	const pick =
		value && typeof value === "object"
			? (value as Record<string, unknown>).credentialConnectionId
			: null;
	return typeof pick === "string" && pick ? pick : null;
}
