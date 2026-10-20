// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How PrismaLens authenticates to a data source it queries (#848 Phase 1).
 * Stored inside the encrypted `Connection.credentialsEnc` blob, so no column carries it.
 */
import { z } from "zod";
import type { TemplateFieldSchema } from "./integration.js";

type TemplateField = z.infer<typeof TemplateFieldSchema>;

export const SOURCE_CREDENTIAL_KINDS = [
	"none",
	"bearer",
	"basic",
	"header",
	"mtls",
] as const;
export type SourceCredentialKind = (typeof SOURCE_CREDENTIAL_KINDS)[number];

/** Mechanisms we know sources use but cannot drive yet; a credential naming one is refused by name. */
export const UNSUPPORTED_CREDENTIAL_KINDS = {
	"aws-sigv4": "AWS SigV4 / assume-role",
	"gcp-workload-identity": "GCP workload identity",
	"azure-managed-identity": "Azure managed identity",
	"oauth-client-credentials": "OAuth client credentials",
	"github-app": "GitHub App",
} as const;
export type UnsupportedCredentialKind =
	keyof typeof UNSUPPORTED_CREDENTIAL_KINDS;

const text = z.string().trim().min(1);
// RFC 7230 token; keeps a header name from smuggling a second header.
const headerName = z
	.string()
	.trim()
	.regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "not a valid header name");
const headerValue = text.regex(/^[^\r\n]*$/, "must be one line");

export const SourceCredentialSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("none") }),
	z.object({ kind: z.literal("bearer"), token: headerValue }),
	z.object({
		kind: z.literal("basic"),
		username: text.regex(/^[^:\r\n]*$/, "cannot contain ':'"),
		password: headerValue,
	}),
	z.object({ kind: z.literal("header"), name: headerName, value: headerValue }),
	z.object({
		kind: z.literal("mtls"),
		cert: text.includes("-----BEGIN", { message: "expects a PEM block" }),
		key: text.includes("-----BEGIN", { message: "expects a PEM block" }),
		ca: z.string().trim().optional(),
	}),
]);
export type SourceCredential = z.infer<typeof SourceCredentialSchema>;

export type ParsedSourceCredential =
	| { ok: true; credential: SourceCredential }
	| { ok: false; reason: "unsupported" | "invalid"; message: string };

/**
 * Reads a stored or submitted credential. A blob with no `kind` (every URL-only row saved
 * before Phase 1) is `none`. Messages never echo a submitted value.
 */
export function parseSourceCredential(raw: unknown): ParsedSourceCredential {
	const obj =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const kind = typeof obj.kind === "string" && obj.kind ? obj.kind : "none";
	if (kind in UNSUPPORTED_CREDENTIAL_KINDS)
		return {
			ok: false,
			reason: "unsupported",
			message: `${UNSUPPORTED_CREDENTIAL_KINDS[kind as UnsupportedCredentialKind]} credentials are not supported yet.`,
		};
	const blank = Object.fromEntries(
		Object.entries({ ...obj, kind }).filter(
			([, v]) => !(typeof v === "string" && v.trim() === ""),
		),
	);
	const parsed = SourceCredentialSchema.safeParse(blank);
	if (parsed.success) return { ok: true, credential: parsed.data };
	if (!(SOURCE_CREDENTIAL_KINDS as readonly string[]).includes(kind))
		return {
			ok: false,
			reason: "invalid",
			message: `Unknown credential kind "${kind.slice(0, 40)}".`,
		};
	const issue = parsed.error.issues[0];
	return {
		ok: false,
		reason: "invalid",
		message: `${kind} credential: ${issue?.path.join(".") || "value"} ${issue?.message ?? "is invalid"}.`,
	};
}

const password = (name: string, label: string): TemplateField => ({
	name,
	label,
	type: "password",
	required: true,
	sensitive: true,
});

/** The form (and future `pl connect`) shape of each kind: one field list per kind. */
export const CREDENTIAL_KIND_FIELDS: Record<
	SourceCredentialKind,
	TemplateField[]
> = {
	none: [],
	bearer: [password("token", "Bearer token")],
	basic: [
		{ name: "username", label: "Username", type: "string", required: true },
		password("password", "Password"),
	],
	header: [
		{
			name: "name",
			label: "Header name",
			type: "string",
			required: true,
			placeholder: "CF-Access-Client-Secret",
		},
		password("value", "Header value"),
	],
	mtls: [
		{
			name: "cert",
			label: "Client certificate (PEM)",
			type: "textarea",
			required: true,
		},
		{
			name: "key",
			label: "Client key (PEM)",
			type: "textarea",
			required: true,
			sensitive: true,
		},
		{ name: "ca", label: "CA certificate (PEM)", type: "textarea" },
	],
};

export const CREDENTIAL_KIND_LABELS: Record<SourceCredentialKind, string> = {
	none: "None",
	bearer: "Bearer token",
	basic: "Username and password",
	header: "Custom header",
	mtls: "Client certificate (mTLS)",
};
