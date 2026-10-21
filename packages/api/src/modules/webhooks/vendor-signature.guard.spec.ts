// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHmac } from "node:crypto";
import {
	type ExecutionContext,
	Logger,
	UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";

const SHARED = "shared-secret-shared-secret";
const SENTRY = "sentry-secret-sentry-secret";
const PAGERDUTY = "pagerduty-secret-pagerduty";

const config = (extra: Record<string, string> = {}) =>
	({
		get: (key: string) =>
			key === "PRISMALENS_WEBHOOK_SECRET" ? SHARED : extra[key],
	}) as unknown as ConfigService;

function request(
	path: string,
	body: string,
	headers: Record<string, string> = {},
	query: Record<string, string> = {},
): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				path,
				headers,
				query,
				rawBody: Buffer.from(body),
			}),
		}),
	} as unknown as ExecutionContext;
}

const hmac = (secret: string, body: string) =>
	createHmac("sha256", secret).update(body).digest("hex");

describe("WebhookSignatureGuard, CloudWatch via SNS (#79)", () => {
	beforeEach(() => {
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
	});

	it("challenges for Basic auth when the CloudWatch route arrives with no credentials", () => {
		const setHeader = vi.fn();
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => ({
					path: "/api/webhooks/cloudwatch",
					headers: {},
					query: {},
					rawBody: Buffer.from("{}"),
				}),
				getResponse: () => ({ setHeader }),
			}),
		} as unknown as ExecutionContext;
		expect(() => new WebhookSignatureGuard(config()).canActivate(ctx)).toThrow(
			UnauthorizedException,
		);
		expect(setHeader).toHaveBeenCalledWith(
			"WWW-Authenticate",
			expect.stringMatching(/^Basic /),
		);
	});
});

describe("WebhookSignatureGuard, vendor signatures (#79)", () => {
	const body = '{"action":"triggered"}';
	beforeEach(() => {
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
	});

	const withSecrets = () =>
		new WebhookSignatureGuard(
			config({
				PRISMALENS_SENTRY_WEBHOOK_SECRET: SENTRY,
				PRISMALENS_PAGERDUTY_WEBHOOK_SECRET: PAGERDUTY,
			}),
		);

	it("accepts a valid Sentry signature on the Sentry route when its secret is set", () => {
		const ctx = request("/api/webhooks/sentry", body, {
			"sentry-hook-signature": hmac(SENTRY, body),
		});
		expect(withSecrets().canActivate(ctx)).toBe(true);
	});

	it("refuses a bad Sentry signature", () => {
		const ctx = request("/api/webhooks/sentry", body, {
			"sentry-hook-signature": hmac("wrong-wrong-wrong-wrong", body),
		});
		expect(() => withSecrets().canActivate(ctx)).toThrow(UnauthorizedException);
	});

	it("refuses a Sentry signature when no Sentry secret is configured", () => {
		const ctx = request("/api/webhooks/sentry", body, {
			"sentry-hook-signature": hmac(SENTRY, body),
		});
		expect(() =>
			new WebhookSignatureGuard(config()).canActivate(ctx),
		).toThrow(UnauthorizedException);
	});

	it("accepts a valid PagerDuty signature and refuses a bad one", () => {
		const good = request("/api/webhooks/pagerduty", body, {
			"x-pagerduty-signature": `v1=${hmac(PAGERDUTY, body)}`,
		});
		expect(withSecrets().canActivate(good)).toBe(true);
		const bad = request("/api/webhooks/pagerduty", body, {
			"x-pagerduty-signature": `v1=${hmac("nope-nope-nope-nope", body)}`,
		});
		expect(() => withSecrets().canActivate(bad)).toThrow(UnauthorizedException);
	});

	it("does not take a Sentry signature on another vendor's route", () => {
		const ctx = request("/api/webhooks/datadog", body, {
			"sentry-hook-signature": hmac(SENTRY, body),
		});
		expect(() => withSecrets().canActivate(ctx)).toThrow(UnauthorizedException);
	});

	it("takes the shared secret as ?token= on the Azure route only", () => {
		const guard = withSecrets();
		expect(
			guard.canActivate(
				request("/api/webhooks/azure-monitor", body, {}, { token: SHARED }),
			),
		).toBe(true);
		expect(() =>
			guard.canActivate(
				request("/api/webhooks/azure-monitor", body, {}, { token: "nope" }),
			),
		).toThrow(UnauthorizedException);
		expect(() =>
			guard.canActivate(
				request("/api/webhooks/grafana", body, {}, { token: SHARED }),
			),
		).toThrow(UnauthorizedException);
	});
});
