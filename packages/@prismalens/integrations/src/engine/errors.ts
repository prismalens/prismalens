// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Structured error types for the auth lifecycle.
 * Enables callers to handle specific failure modes
 * (e.g., show "re-authorize" UI on CredentialsInvalidError).
 */

export class AuthError extends Error {
	readonly connectionId: string;
	readonly templateId?: string;
	readonly provider?: string;

	constructor(
		message: string,
		opts: {
			connectionId: string;
			templateId?: string;
			provider?: string;
		},
	) {
		super(message);
		this.name = "AuthError";
		this.connectionId = opts.connectionId;
		this.templateId = opts.templateId;
		this.provider = opts.provider;
	}
}

export class TokenExpiredError extends AuthError {
	constructor(opts: {
		connectionId: string;
		templateId?: string;
		provider?: string;
	}) {
		super("Token expired, refresh needed", opts);
		this.name = "TokenExpiredError";
	}
}

export class TokenRefreshError extends AuthError {
	constructor(
		message: string,
		opts: {
			connectionId: string;
			templateId?: string;
			provider?: string;
		},
	) {
		super(message, opts);
		this.name = "TokenRefreshError";
	}
}

export class ProviderError extends AuthError {
	readonly httpStatus: number;
	readonly responseBody?: string;

	constructor(
		message: string,
		opts: {
			connectionId: string;
			httpStatus: number;
			responseBody?: string;
			templateId?: string;
			provider?: string;
		},
	) {
		super(message, opts);
		this.name = "ProviderError";
		this.httpStatus = opts.httpStatus;
		this.responseBody = opts.responseBody;
	}
}

export class RateLimitError extends ProviderError {
	readonly retryAfter?: number;

	constructor(opts: {
		connectionId: string;
		retryAfter?: number;
		responseBody?: string;
		templateId?: string;
		provider?: string;
	}) {
		super("Rate limit exceeded", {
			...opts,
			httpStatus: 429,
		});
		this.name = "RateLimitError";
		this.retryAfter = opts.retryAfter;
	}
}

export class CredentialsInvalidError extends AuthError {
	constructor(opts: {
		connectionId: string;
		templateId?: string;
		provider?: string;
	}) {
		super("Credentials rejected after refresh retry", opts);
		this.name = "CredentialsInvalidError";
	}
}
