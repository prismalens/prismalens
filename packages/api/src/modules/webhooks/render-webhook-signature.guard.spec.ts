// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHmac } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { RENDER_WEBHOOK_PATH } from "../../shared/constants/routes.js";
import { RenderWebhookSignatureGuard } from "./render-webhook-signature.guard.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";

const TEST_SECRET = "whsec_Mf2FtEYoikCpL3NxNas/MStRxV38XYOC";
const GENERIC_SECRET = "generic_secret_1234567890";

/**
 * Deliberately non-canonical JSON: indented, and with keys in an order
 * `JSON.stringify` would not reproduce from the parsed object. Verification
 * must run over exactly these bytes.
 */
const RAW_DELIVERY = `{
  "service": { "name": "test", "id": "srv-1" },
  "type": "deploy"
}`;

/** What a body parser produces from RAW_DELIVERY — never the signed bytes. */
const PARSED_DELIVERY = JSON.parse(RAW_DELIVERY) as Record<string, unknown>;

const configWith = (values: Record<string, string>) =>
	({
		get: (key: string) => values[key],
	}) as unknown as ConfigService;

/**
 * Mirrors what reaches a guard at runtime: `rawBody` is the buffer captured by
 * WebhookRawBodyMiddleware, `body` is the parsed object, and `path` carries the
 * global API prefix.
 */
const createMockContext = ({
	headers = {},
	rawBody,
	body,
	path = RENDER_WEBHOOK_PATH,
}: {
	headers?: Record<string, string | undefined>;
	rawBody?: Buffer;
	body?: unknown;
	path?: string;
}): ExecutionContext =>
	({
		switchToHttp: () => ({
			getRequest: () => ({ headers, rawBody, body, path }),
		}),
	}) as unknown as ExecutionContext;

const signRender = (payload: string, msgId = "msg_123456789") => {
	const now = new Date();
	const signature = new Webhook(TEST_SECRET).sign(msgId, now, payload);
	return {
		msgId,
		timestamp: `${Math.floor(now.getTime() / 1000)}`,
		signature,
	};
};

describe("RenderWebhookSignatureGuard", () => {
	it("allows requests when no secret is configured", () => {
		const guard = new RenderWebhookSignatureGuard(configWith({}));

		expect(guard.canActivate(createMockContext({}))).toBe(true);
	});

	it("verifies the signature against the raw bytes, not the parsed body", () => {
		const guard = new RenderWebhookSignatureGuard(
			configWith({ PRISMALENS_RENDER_WEBHOOK_SECRET: TEST_SECRET }),
		);
		const { msgId, timestamp, signature } = signRender(RAW_DELIVERY);

		// Guard rail: the bytes the sender signed do NOT survive a parse +
		// re-stringify round trip, so a guard that reserialized would fail here.
		expect(JSON.stringify(PARSED_DELIVERY)).not.toBe(RAW_DELIVERY);

		const context = createMockContext({
			headers: {
				"webhook-id": msgId,
				"webhook-timestamp": timestamp,
				"webhook-signature": signature,
			},
			rawBody: Buffer.from(RAW_DELIVERY, "utf8"),
			body: PARSED_DELIVERY,
		});

		expect(guard.canActivate(context)).toBe(true);
	});

	it("ignores the parsed body entirely — only rawBody decides", () => {
		const guard = new RenderWebhookSignatureGuard(
			configWith({ PRISMALENS_RENDER_WEBHOOK_SECRET: TEST_SECRET }),
		);
		const { msgId, timestamp, signature } = signRender(RAW_DELIVERY);

		const context = createMockContext({
			headers: {
				"webhook-id": msgId,
				"webhook-timestamp": timestamp,
				"webhook-signature": signature,
			},
			rawBody: Buffer.from(RAW_DELIVERY, "utf8"),
			// A body that shares nothing with the signed bytes.
			body: { totally: "unrelated" },
		});

		expect(guard.canActivate(context)).toBe(true);
	});

	it("accepts the svix-* header fallback over the same raw bytes", () => {
		const guard = new RenderWebhookSignatureGuard(
			configWith({ PRISMALENS_RENDER_WEBHOOK_SECRET: TEST_SECRET }),
		);
		const { msgId, timestamp, signature } = signRender(RAW_DELIVERY);

		const context = createMockContext({
			headers: {
				"svix-id": msgId,
				"svix-timestamp": timestamp,
				"svix-signature": signature,
			},
			rawBody: Buffer.from(RAW_DELIVERY, "utf8"),
			body: PARSED_DELIVERY,
		});

		expect(guard.canActivate(context)).toBe(true);
	});

	/**
	 * The production bug this guard used to ship: with `bodyParser: false` no
	 * raw bytes reached the guard, and the fallback verified a reserialization
	 * of the parsed body. A guard that reserializes ACCEPTS this request; the
	 * correct behaviour is to reject, because nothing proves what was signed.
	 */
	it("rejects a validly signed request when raw bytes were not captured", () => {
		const guard = new RenderWebhookSignatureGuard(
			configWith({ PRISMALENS_RENDER_WEBHOOK_SECRET: TEST_SECRET }),
		);
		const canonical = JSON.stringify(PARSED_DELIVERY);
		const { msgId, timestamp, signature } = signRender(canonical);

		const context = createMockContext({
			headers: {
				"webhook-id": msgId,
				"webhook-timestamp": timestamp,
				"webhook-signature": signature,
			},
			rawBody: undefined,
			body: PARSED_DELIVERY,
		});

		expect(guard.canActivate(context)).toBe(false);
	});

	it("rejects requests with missing signature headers", () => {
		const guard = new RenderWebhookSignatureGuard(
			configWith({ PRISMALENS_RENDER_WEBHOOK_SECRET: TEST_SECRET }),
		);

		const context = createMockContext({
			rawBody: Buffer.from(RAW_DELIVERY, "utf8"),
		});

		expect(guard.canActivate(context)).toBe(false);
	});

	it("rejects requests whose raw bytes were altered in transit", () => {
		const guard = new RenderWebhookSignatureGuard(
			configWith({ PRISMALENS_RENDER_WEBHOOK_SECRET: TEST_SECRET }),
		);
		const { msgId, timestamp, signature } = signRender(RAW_DELIVERY);

		const context = createMockContext({
			headers: {
				"webhook-id": msgId,
				"webhook-timestamp": timestamp,
				"webhook-signature": signature,
			},
			rawBody: Buffer.from(`${RAW_DELIVERY} `, "utf8"),
			body: PARSED_DELIVERY,
		});

		expect(guard.canActivate(context)).toBe(false);
	});

	it("rejects requests with an invalid signature", () => {
		const guard = new RenderWebhookSignatureGuard(
			configWith({ PRISMALENS_RENDER_WEBHOOK_SECRET: TEST_SECRET }),
		);

		const context = createMockContext({
			headers: {
				"webhook-id": "msg_123",
				"webhook-timestamp": `${Math.floor(Date.now() / 1000)}`,
				"webhook-signature": "v1,invalid_signature",
			},
			rawBody: Buffer.from(RAW_DELIVERY, "utf8"),
		});

		expect(guard.canActivate(context)).toBe(false);
	});
});

describe("WebhookSignatureGuard", () => {
	it("bypasses the Render route at its prefixed runtime path", () => {
		const guard = new WebhookSignatureGuard(
			configWith({ PRISMALENS_WEBHOOK_SECRET: GENERIC_SECRET }),
		);

		const context = createMockContext({ path: RENDER_WEBHOOK_PATH });

		expect(guard.canActivate(context)).toBe(true);
	});

	/**
	 * Regression: the bypass used to compare the unprefixed contract path, which
	 * never matches once `setGlobalPrefix("api")` is applied. Pinning the actual
	 * runtime path keeps that mismatch from coming back.
	 */
	it("uses the /api-prefixed path, not the unprefixed contract path", () => {
		expect(RENDER_WEBHOOK_PATH).toBe("/api/webhooks/render");

		const guard = new WebhookSignatureGuard(
			configWith({ PRISMALENS_WEBHOOK_SECRET: GENERIC_SECRET }),
		);

		// An unprefixed path is not a real runtime path, so it must not bypass.
		const context = createMockContext({ path: "/webhooks/render" });

		expect(guard.canActivate(context)).toBe(false);
	});

	it("verifies the HMAC against the raw bytes of a generic delivery", () => {
		const guard = new WebhookSignatureGuard(
			configWith({ PRISMALENS_WEBHOOK_SECRET: GENERIC_SECRET }),
		);
		const digest = createHmac("sha256", GENERIC_SECRET)
			.update(Buffer.from(RAW_DELIVERY, "utf8"))
			.digest("hex");

		const context = createMockContext({
			headers: { "x-hub-signature-256": `sha256=${digest}` },
			rawBody: Buffer.from(RAW_DELIVERY, "utf8"),
			body: PARSED_DELIVERY,
			path: "/api/webhooks/generic",
		});

		expect(guard.canActivate(context)).toBe(true);
	});

	it("rejects a generic delivery when raw bytes were not captured", () => {
		const guard = new WebhookSignatureGuard(
			configWith({ PRISMALENS_WEBHOOK_SECRET: GENERIC_SECRET }),
		);
		const canonical = JSON.stringify(PARSED_DELIVERY);
		const digest = createHmac("sha256", GENERIC_SECRET)
			.update(canonical)
			.digest("hex");

		const context = createMockContext({
			headers: { "x-hub-signature-256": `sha256=${digest}` },
			rawBody: undefined,
			body: PARSED_DELIVERY,
			path: "/api/webhooks/generic",
		});

		expect(guard.canActivate(context)).toBe(false);
	});

	it("allows any request when no generic secret is configured", () => {
		const guard = new WebhookSignatureGuard(configWith({}));

		const context = createMockContext({ path: "/api/webhooks/generic" });

		expect(guard.canActivate(context)).toBe(true);
	});
});
