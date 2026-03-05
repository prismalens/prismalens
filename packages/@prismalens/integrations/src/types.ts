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
	type: z.enum(["string", "password", "select", "number", "boolean"]),
	default: z.string().optional(),
	required: z.boolean().optional(),
	placeholder: z.string().optional(),
	description: z.string().optional(),
	example: z.string().optional(),
	pattern: z.string().optional(),
	options: z.array(TemplateFieldOptionSchema).optional(),
	sensitive: z.boolean().optional(),
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
}

// =============================================================================
// AUTH TEMPLATE
// =============================================================================

export interface AuthTemplate {
	id: string;
	name: string;
	category: string;
	authMode: AuthMode;
	icon?: string;
	docsUrl?: string;
	connectionFields?: TemplateField[];
	credentialFields?: TemplateField[];
	oauth2?: OAuth2Config;
	authenticate: {
		headers: Record<string, string>;
	};
	proxy: {
		baseUrl: string;
		headers?: Record<string, string>;
	};
	verify?: {
		method: string;
		path: string;
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

// =============================================================================
// EVENT TYPES (type-only, no bus yet)
// =============================================================================

export type IntegrationEventType =
	| "connection.created"
	| "connection.updated"
	| "connection.deleted"
	| "connection.broken"
	| "connection.refreshed"
	| "connection.tested";

export interface IntegrationEvent {
	type: IntegrationEventType;
	connectionId: string;
	integrationId: string;
	templateId: string;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}
