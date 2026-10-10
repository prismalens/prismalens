// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Connection, Integration } from "@prismalens/database";
import { getTemplate } from "@prismalens/integrations";
import {
	hostFromGithubBaseUrl,
	normalizeGitHost,
	tokenFrom,
} from "../../core/harness/git-credential.js";
import type { CredentialsService } from "./crypto/credentials.service.js";

/** A saved git host token, decrypted. `token` never reaches a response or a log. */
export interface HostToken {
	connectionId: string;
	label: string;
	templateId: string;
	host: string;
	token: string;
	fingerprint: string;
	status: string;
	tokenExpiresAt: Date | null;
	lastErrorMessage: string | null;
}

/** A git host template: Test and the resolver treat its rows as clone credentials. */
export function isGitHostTemplate(templateId: string): boolean {
	return getTemplate(templateId)?.gitHost === true;
}

/** The host and token a git host connection holds, or null when it holds none. */
export function readHostToken(
	conn: Connection & { integration: Integration },
	credentials: CredentialsService,
): HostToken | null {
	if (!isGitHostTemplate(conn.integration.templateId)) return null;
	let creds: Record<string, unknown> = {};
	let config: Record<string, unknown> = {};
	try {
		creds = credentials.decrypt<Record<string, unknown>>(
			Buffer.from(conn.credentialsEnc),
		);
		if (conn.connectionConfigEnc)
			config = credentials.decrypt<Record<string, unknown>>(
				Buffer.from(conn.connectionConfigEnc),
			);
	} catch {
		return null;
	}
	const host =
		conn.integration.templateId === "github-token"
			? hostFromGithubBaseUrl(creds.baseUrl ?? config.baseUrl)
			: normalizeGitHost(typeof config.host === "string" ? config.host : "");
	const token = tokenFrom(creds);
	if (!host || !token) return null;
	return {
		connectionId: conn.id,
		label: conn.label || conn.integration.label,
		templateId: conn.integration.templateId,
		host,
		token,
		fingerprint: credentials.getVault().hmacHex(`${host}:${token}`).slice(0, 8),
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
