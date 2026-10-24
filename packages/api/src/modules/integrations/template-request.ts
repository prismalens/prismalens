// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Requests through a template's `proxy` and `authenticate` config (#848). The token is
 * the credential kind's authorized bearer value; an OAuth 401 renews once.
 */
import type { SourceCredential } from "@prismalens/contracts/schemas";
import {
	type AuthenticatedRequestFn,
	type AuthTemplate,
	type CredentialKind,
	CredentialsInvalidError,
	credentialKind,
	interpolate,
	interpolateRecord,
	ProviderError,
	RateLimitError,
	SignInExpired,
} from "@prismalens/integrations";
import { tokenFrom } from "../../core/harness/git-credential.js";
import type { SourceConnection } from "./source-request.js";
import { bearerOf, type Stored } from "./stored-credential.js";

export interface TemplateConnection {
	connectionId: string;
	template: AuthTemplate;
	/** The decrypted blob, for template fields beside the token. */
	blob: Record<string, unknown>;
	stored: Stored;
	connection: SourceConnection;
	fetchImpl?: typeof fetch;
}

async function bearerValue(
	t: TemplateConnection,
	credential: SourceCredential | null,
	renew?: { failedToken: string },
): Promise<string> {
	if (!credential || credential.kind === "none") return tokenFrom(t.blob) ?? "";
	const kind = credentialKind(credential.kind) as CredentialKind;
	try {
		const auth = await kind.authorize(
			credential as never,
			{
				connectionId: t.connectionId,
				origin: "",
				fetch: t.fetchImpl ?? fetch,
				load: t.connection.load,
				save: t.connection.save,
			},
			renew ? { renew } : undefined,
		);
		return bearerOf(auth.headers) ?? "";
	} catch (e) {
		if (e instanceof SignInExpired)
			await t.connection.report?.({
				kind: "sign-in-expired",
				message: e.message,
			});
		throw e;
	}
}

function context(t: TemplateConnection, token: string): Record<string, string> {
	const defaults: Record<string, string> = {};
	for (const f of [
		...(t.template.integrationCredentialFields ?? []),
		...(t.template.connectionCredentialFields ?? []),
	])
		if (typeof f.default === "string" && f.default)
			defaults[f.name] = f.default;
	const strings = Object.fromEntries(
		Object.entries(t.blob).filter(([, v]) => typeof v === "string"),
	) as Record<string, string>;
	return {
		...defaults,
		...strings,
		...(t.stored.baseUrl ? { baseUrl: t.stored.baseUrl } : {}),
		accessToken: token,
		installationToken: token,
		apiKey: token,
	};
}

export function templateRequestFn(
	load: () => Promise<TemplateConnection>,
): AuthenticatedRequestFn {
	return async (method, path, options) => {
		const t = await load();
		const credential = t.stored.credential.ok
			? t.stored.credential.credential
			: null;
		if (!credential && !tokenFrom(t.blob))
			throw new CredentialsInvalidError({
				connectionId: t.connectionId,
				templateId: t.template.id,
				provider: t.template.name,
			});
		const send = async (token: string) => {
			const ctx = context(t, token);
			const base = t.template.proxy.baseUrl.includes("{{")
				? interpolate(t.template.proxy.baseUrl, ctx)
				: t.template.proxy.baseUrl;
			const url = new URL(`${base}${path}`);
			// The token goes only to the template's own origin.
			if (url.origin !== new URL(base).origin)
				throw new ProviderError("the request leaves the source's origin", {
					connectionId: t.connectionId,
					httpStatus: 0,
				});
			return (t.fetchImpl ?? fetch)(url.href, {
				method,
				headers: {
					...interpolateRecord(t.template.proxy.headers ?? {}, ctx),
					...interpolateRecord(t.template.authenticate.headers ?? {}, ctx),
					...options?.headers,
				},
				body: options?.body,
				signal: options?.signal ?? AbortSignal.timeout(30_000),
			});
		};
		const meta = {
			connectionId: t.connectionId,
			templateId: t.template.id,
			provider: t.template.name,
		};
		let token = await bearerValue(t, credential);
		let res = await send(token);
		if (
			res.status === 401 &&
			(credential?.kind === "oauth" || credential?.kind === "oauth-client")
		) {
			await res.body?.cancel();
			token = await bearerValue(t, credential, { failedToken: token });
			res = await send(token);
		}
		if (res.status === 401) {
			await res.body?.cancel();
			throw new CredentialsInvalidError(meta);
		}
		if (res.status === 429) {
			await res.body?.cancel();
			const retryAfter = Number.parseInt(
				res.headers.get("retry-after") ?? "",
				10,
			);
			throw new RateLimitError({
				...meta,
				retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter,
			});
		}
		if (!res.ok) {
			await res.body?.cancel();
			throw new ProviderError(`Provider returned ${res.status}`, {
				...meta,
				httpStatus: res.status,
			});
		}
		return res;
	};
}

/** The template's `verify` request, as a pass or a PrismaLens-worded failure. */
export async function verifyTemplate(
	request: AuthenticatedRequestFn,
	template: AuthTemplate,
): Promise<{ success: boolean; error?: string }> {
	if (!template.verify) return { success: true };
	try {
		const res = await request(template.verify.method, template.verify.path);
		await res.body?.cancel();
		return { success: true };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : "Connection failed",
		};
	}
}
