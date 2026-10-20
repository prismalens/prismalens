// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	DISCLOSURE,
	LOOPBACK_REDIRECT_URI,
	needsDisclosure,
	type SourceTypeDescriptor,
	shippedAppFor,
} from "@prismalens/contracts/schemas";
import { useId } from "react";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./Field";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** A local install comes back on the pinned loopback; a server on its own route (04). */
export function callbackUrl(): { url: string; local: boolean } {
	const local = LOOPBACK_HOSTS.has(window.location.hostname);
	return local
		? { url: LOOPBACK_REDIRECT_URI, local }
		: { url: `${window.location.origin}/api/sources/oauth/callback`, local };
}

export interface SignInValues {
	clientId: string;
	clientSecret: string;
	/** Space-separated; replaces the descriptor's scopes when set. */
	scopes: string;
}

/**
 * Sign in (#848, 04): one button where this build ships a PrismaLens app for the vendor's
 * cloud, otherwise "use your own app" with the exact callback URL and scopes to register.
 */
export function SignInPanel({
	type,
	url,
	values,
	onChange,
	onSignIn,
	pending,
	waiting,
}: {
	type: SourceTypeDescriptor;
	url: string;
	values: SignInValues;
	onChange: (v: SignInValues) => void;
	onSignIn: () => void;
	pending: boolean;
	waiting: boolean;
}) {
	const ids = { id: useId(), secret: useId(), scopes: useId() };
	const callback = callbackUrl();
	let shipped = null;
	try {
		shipped = callback.local && url ? shippedAppFor(type, url) : null;
	} catch {
		shipped = null;
	}
	const onCloud =
		type.oauth?.cloudOrigin && url.startsWith(type.oauth.cloudOrigin);
	const scopes = type.oauth?.scopes ?? [];
	const secretNeeded =
		type.oauth?.shippedApp !== "gitlab" && type.id !== "mcp-server";
	return (
		<div className="space-y-3" data-testid="sign-in-panel">
			{!shipped && type.id !== "mcp-server" && (
				<div
					className="space-y-3 rounded-control bg-surface-3 px-3 py-2"
					data-testid="byo-app"
				>
					{onCloud && type.oauth?.shippedApp && (
						<p className="text-meta text-text-2" data-testid="no-shipped-app">
							PrismaLens has no app for {type.vendor} in this build; register
							your own or use a token.
						</p>
					)}
					<p className="text-meta text-text-2">
						Register an app with {type.vendor} with the callback{" "}
						<Mono data-testid="byo-callback">{callback.url}</Mono>
						{scopes.length > 0 && (
							<>
								{" "}
								and the scopes <Mono>{scopes.join(" ")}</Mono>
							</>
						)}
						, then enter its client ID.
					</p>
					<Field label="Client ID" htmlFor={ids.id}>
						<Input
							id={ids.id}
							value={values.clientId}
							onChange={(e) =>
								onChange({ ...values, clientId: e.target.value })
							}
							data-testid="byo-client-id"
						/>
					</Field>
					<Field
						label={
							secretNeeded
								? "Client secret"
								: "Client secret (if the app has one)"
						}
						htmlFor={ids.secret}
					>
						<Input
							id={ids.secret}
							type="password"
							value={values.clientSecret}
							onChange={(e) =>
								onChange({ ...values, clientSecret: e.target.value })
							}
							data-testid="byo-client-secret"
						/>
					</Field>
				</div>
			)}
			<details className="text-meta text-text-3">
				<summary>Advanced</summary>
				<Field label="Scopes" htmlFor={ids.scopes}>
					<Input
						id={ids.scopes}
						value={values.scopes}
						placeholder={scopes.join(" ") || "as the server asks"}
						onChange={(e) => onChange({ ...values, scopes: e.target.value })}
						data-testid="sign-in-scopes"
					/>
				</Field>
			</details>
			<Button
				variant="primary"
				disabled={
					pending ||
					waiting ||
					(!shipped && type.id !== "mcp-server" && !values.clientId.trim())
				}
				onClick={onSignIn}
				data-testid="sign-in"
			>
				{waiting
					? "Waiting for the sign-in to finish"
					: `Sign in with ${type.id === "mcp-server" ? "the MCP server" : type.vendor}`}
			</Button>
		</div>
	);
}

/** OBJ-013: the line shown on the confirm step and the source's row. */
export function disclosureFor(
	type: SourceTypeDescriptor,
	kind: string,
	granted: string[] | null | undefined,
): string | null {
	if (kind === "none") return null;
	const signIn = kind === "oauth" || kind === "mcp-oauth";
	if (type.id === "mcp-server")
		return signIn ? DISCLOSURE.signIn : DISCLOSURE.token;
	if (!type.oauth) return null;
	if (!signIn) return DISCLOSURE.token;
	return needsDisclosure(type, granted ?? null) ? DISCLOSURE.signIn : null;
}

export function Disclosure({ text }: { text: string | null }) {
	if (!text) return null;
	return (
		<p className="text-meta text-text-2" data-testid="disclosure">
			{text}
		</p>
	);
}
