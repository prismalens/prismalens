// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The credential port: how one stored credential kind authorizes a request (#848). */
import type { SourceCredential } from "@prismalens/contracts/schemas";

export interface CredentialContext {
	connectionId: string;
	/** The Connection's base URL origin; the credential goes nowhere else. */
	origin: string;
	fetch: typeof fetch;
	/** Re-reads the stored credential; used inside the connection lock (OBJ-007). */
	load(): Promise<SourceCredential>;
	/** Writes back a rotated refresh token. */
	save(next: SourceCredential): Promise<void>;
	signal?: AbortSignal;
}

export interface Authorization {
	headers: Record<string, string>;
	tls?: { cert: string; key: string; ca?: string };
}

export interface CredentialKind<
	K extends SourceCredential["kind"] = SourceCredential["kind"],
> {
	kind: K;
	enrol: "none" | "paste" | "sign-in";
	/** Every secret it holds now, including a cached access token. */
	secrets(
		c: Extract<SourceCredential, { kind: K }>,
		ctx: { connectionId: string },
	): string[];
	authorize(
		c: Extract<SourceCredential, { kind: K }>,
		ctx: CredentialContext,
		opts?: { renew?: { failedToken: string } },
	): Promise<Authorization>;
}
