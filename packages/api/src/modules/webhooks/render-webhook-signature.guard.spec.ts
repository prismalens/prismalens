// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { RenderWebhookSignatureGuard } from "./render-webhook-signature.guard.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";

const TEST_SECRET = "whsec_Mf2FtEYoikCpL3NxNas/MStRxV38XYOC";

describe("RenderWebhookSignatureGuard", () => {
	let guard: RenderWebhookSignatureGuard;

	const createMockContext = (
		headers: Record<string, string | undefined>,
		body: unknown = {},
		path = "/webhooks/render",
	): ExecutionContext => {
		return {
			switchToHttp: () => ({
				getRequest: () => ({
					headers,
					body,
					path,
				}),
			}),
		} as unknown as ExecutionContext;
	};

	it("allows requests when no secret is configured", () => {
		const mockConfigService = {
			get: () => undefined,
		};
		guard = new RenderWebhookSignatureGuard(
			mockConfigService as unknown as ConfigService,
		);

		const context = createMockContext({});
		expect(guard.canActivate(context)).toBe(true);
	});

	it("allows requests with valid webhook-signature headers", () => {
		const mockConfigService = {
			get: (key: string) =>
				key === "PRISMALENS_RENDER_WEBHOOK_SECRET" ? TEST_SECRET : undefined,
		};
		guard = new RenderWebhookSignatureGuard(
			mockConfigService as unknown as ConfigService,
		);

		const wh = new Webhook(TEST_SECRET);
		const payload = { type: "deploy", service: { id: "srv-1", name: "test" } };
		const now = new Date();
		const msgId = "msg_123456789";
		const rawPayload = JSON.stringify(payload);
		const sig = wh.sign(msgId, now, rawPayload);

		const headers = {
			"webhook-id": msgId,
			"webhook-timestamp": `${Math.floor(now.getTime() / 1000)}`,
			"webhook-signature": sig,
		};

		const context = createMockContext(headers, payload);
		expect(guard.canActivate(context)).toBe(true);
	});

	it("allows requests with valid svix-signature headers (fallback path)", () => {
		const mockConfigService = {
			get: (key: string) =>
				key === "PRISMALENS_RENDER_WEBHOOK_SECRET" ? TEST_SECRET : undefined,
		};
		guard = new RenderWebhookSignatureGuard(
			mockConfigService as unknown as ConfigService,
		);

		const wh = new Webhook(TEST_SECRET);
		const payload = { type: "deploy", service: { id: "srv-1", name: "test" } };
		const now = new Date();
		const msgId = "msg_123456789";
		const rawPayload = JSON.stringify(payload);
		const sig = wh.sign(msgId, now, rawPayload);

		const headers = {
			"svix-id": msgId,
			"svix-timestamp": `${Math.floor(now.getTime() / 1000)}`,
			"svix-signature": sig,
		};

		const context = createMockContext(headers, payload);
		expect(guard.canActivate(context)).toBe(true);
	});

	it("rejects requests with missing signature headers", () => {
		const mockConfigService = {
			get: (key: string) =>
				key === "PRISMALENS_RENDER_WEBHOOK_SECRET" ? TEST_SECRET : undefined,
		};
		guard = new RenderWebhookSignatureGuard(
			mockConfigService as unknown as ConfigService,
		);

		const context = createMockContext({});
		expect(guard.canActivate(context)).toBe(false);
	});

	it("rejects requests with invalid signature", () => {
		const mockConfigService = {
			get: (key: string) =>
				key === "PRISMALENS_RENDER_WEBHOOK_SECRET" ? TEST_SECRET : undefined,
		};
		guard = new RenderWebhookSignatureGuard(
			mockConfigService as unknown as ConfigService,
		);

		const headers = {
			"webhook-id": "msg_123",
			"webhook-timestamp": `${Math.floor(Date.now() / 1000)}`,
			"webhook-signature": "v1,invalid_signature",
		};

		const context = createMockContext(headers, {});
		expect(guard.canActivate(context)).toBe(false);
	});
});

describe("WebhookSignatureGuard bypass for /webhooks/render", () => {
	it("bypasses generic WebhookSignatureGuard when path is /webhooks/render", () => {
		const mockConfigService = {
			get: (key: string) =>
				key === "PRISMALENS_WEBHOOK_SECRET"
					? "generic_secret_1234567890"
					: undefined,
		};
		const genericGuard = new WebhookSignatureGuard(
			mockConfigService as unknown as ConfigService,
		);

		const context = {
			switchToHttp: () => ({
				getRequest: () => ({
					headers: {},
					body: {},
					path: "/webhooks/render",
				}),
			}),
		} as unknown as ExecutionContext;

		expect(genericGuard.canActivate(context)).toBe(true);
	});
});
