// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PermissionRequirement,
	TemplateCategory,
} from "@prismalens/config/integrations";
import { z } from "zod";

// =============================================================================
// AUTH MODE
// =============================================================================

export const AuthModeSchema = z.enum(["api_key", "basic", "oauth2"]);
export type AuthMode = z.infer<typeof AuthModeSchema>;

// =============================================================================
// TEMPLATE FIELD (credential + connection fields)
// =============================================================================

export const TemplateFieldOptionSchema = z.object({
	label: z.string(),
	value: z.string(),
});

export const TemplateFieldSchema = z.object({
	name: z.string(),
	label: z.string(),
	type: z.enum([
		"string",
		"password",
		"select",
		"number",
		"boolean",
		"textarea",
	]),
	default: z.string().optional(),
	required: z.boolean().optional(),
	placeholder: z.string().optional(),
	description: z.string().optional(),
	example: z.string().optional(),
	pattern: z.string().optional(),
	options: z.array(TemplateFieldOptionSchema).optional(),
	sensitive: z.boolean().optional(),
	readonly: z.boolean().optional(),
	hidden: z.boolean().optional(),
});

export type TemplateFieldOption = z.infer<typeof TemplateFieldOptionSchema>;
export type TemplateField = z.infer<typeof TemplateFieldSchema>;

// =============================================================================
// OAUTH2 CONFIG
// =============================================================================

export interface OAuth2Config {
	authorizationUrl: string;
	tokenUrl: string;
	refreshUrl?: string;
	scopes?: string[];
	scopeSeparator?: string;
	authorizationParams?: Record<string, string>;
	tokenAuthMethod?: "body" | "header";
	tokenResponseMetadata?: string[];
	rotatesRefreshToken?: boolean;
	tokensNeverExpire?: boolean;
	disablePkce?: boolean;
	clientCredentialSource?: "body" | "header" | "both";
	refreshBuffer?: number;
	grantType?: "authorization_code" | "client_credentials";
}

// =============================================================================
// AUTH TEMPLATE
// =============================================================================

export interface AuthTemplate {
	id: string;
	name: string;
	version: string;
	category: TemplateCategory;
	authMode: AuthMode;
	icon?: string;
	docsUrl?: string;
	setupDocsUrl?: string;
	connectionFields?: TemplateField[];
	/** Secrets for Integration setup (clientId, clientSecret) */
	integrationCredentialFields?: TemplateField[];
	/** Secrets for Connection setup (apiKey, password, token) */
	connectionCredentialFields?: TemplateField[];
	oauth2?: OAuth2Config;
	authenticate: {
		headers?: Record<string, string>;
		query?: Record<string, string>;
		body?: Record<string, string>;
	};
	proxy: {
		baseUrl: string;
		headers?: Record<string, string>;
		rateLimit?: { windowMs: number; maxRequests: number };
		retry?: { maxRetries: number; backoffMs: number };
	};
	verify?: {
		method: "GET" | "POST";
		path: string;
	};
	/** No credentials: the connection's baseUrl is reached directly and `verify` runs against it (#633). */
	urlOnly?: true;
	/** A token git sends over HTTPS to clone; Test runs `git ls-remote` instead of `verify` (#673). */
	gitHost?: true;
	/** Permission requirements — single source of truth for capabilities, defaultPermissions, and scopes */
	requiredPermissions?: PermissionRequirement[];
	/** How connections are created for this template */
	connectionCreation: {
		mode: "form" | "oauth_redirect";
	};
	/** What happens after integration creation */
	postIntegrationCreation: {
		action: "none" | "oauth_redirect" | "navigate";
		navigateTo?: string;
	};
	/** Display metadata */
	display: {
		authModeLabel: string;
		/** False keeps a template working for saved rows but out of the Add menu. */
		listed?: boolean;
	};
}

// =============================================================================
// OAUTH STATE (for DB persistence)
// =============================================================================

export interface OAuthStateData {
	state: string;
	integrationId: string;
	userId: string;
	organizationId?: string;
	callbackUrl: string;
	connectionConfigEnc?: Buffer | null;
	codeVerifier?: string | null;
	metadata?: Record<string, unknown>;
	expiresAt: Date;
}

// =============================================================================
// TOKEN RESULT (from OAuth token exchange)
// =============================================================================

export interface TokenResult {
	accessToken: string;
	refreshToken?: string | null;
	tokenType: string;
	expiresIn?: number | null;
	grantedScopes?: string[];
	metadata?: Record<string, unknown>;
}
