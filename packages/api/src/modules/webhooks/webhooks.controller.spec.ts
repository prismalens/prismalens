// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ExecutionContext } from "@nestjs/common";
import { ServiceUnavailableException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertPullService } from "../alerts/alert-pull.service.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhookThrottleGuard } from "./webhook-throttle.guard.js";
import { WebhooksController } from "./webhooks.controller.js";
import type { WebhooksService } from "./webhooks.service.js";
import { telemetryStub } from "../../../test/factories/index.js";

describe("WebhooksController guards (#637 edge 9)", () => {
	it("rate-limits before authenticating", () => {
		expect(Reflect.getMetadata(GUARDS_METADATA, WebhooksController)).toEqual([
			WebhookThrottleGuard,
			WebhookSignatureGuard,
		]);
	});

	it("answers an over-limit delivery with 503 and Retry-After, which Alertmanager retries", async () => {
		const header = vi.fn();
		const context = {
			switchToHttp: () => ({ getResponse: () => ({ header }) }),
		} as unknown as ExecutionContext;
		const guard = Object.create(WebhookThrottleGuard.prototype) as WebhookThrottleGuard;
		const throwIt = (guard as unknown as {
			throwThrottlingException: (c: ExecutionContext, d: { timeToBlockExpire: number }) => Promise<void>;
		}).throwThrottlingException.bind(guard);

		await expect(throwIt(context, { timeToBlockExpire: 7 })).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
		expect(header).toHaveBeenCalledWith("Retry-After", "7");
	});
});

describe("WebhooksController Prometheus intake (#633 edge 10, #605)", () => {
	let alertPull: { onWebhook: ReturnType<typeof vi.fn> };
	beforeEach(() => {
		alertPull = { onWebhook: vi.fn(() => Promise.resolve()) };
	});

	function prometheusHandler(service: Partial<WebhooksService>) {
		const controller = new WebhooksController(
			service as WebhooksService,
			telemetryStub(),
			alertPull as unknown as AlertPullService,
		);
		const procs = controller.webhooks() as unknown as Record<
			string,
			{ "~orpc": { handler: (a: { input: unknown; context: unknown }) => Promise<unknown> } }
		>;
		return procs.prometheus["~orpc"].handler;
	}

	const firing = {
		status: "firing",
		labels: { alertname: "HighLatency" },
		annotations: {},
		startsAt: "2026-09-19T10:00:00Z",
		fingerprint: "fp-1",
	};

	it("processes alerts through webhooksService.processPrometheusAlert", async () => {
		const service = {
			processPrometheusAlert: vi.fn(async () => ({ alertId: "a1", isNew: true })),
		};
		const res = await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: { request: { headers: { "x-idempotency-key": "batch-key" } } },
		});
		expect(service.processPrometheusAlert).toHaveBeenCalledWith(firing, {
			idempotencyKey: "batch-key:fp-1",
			source: "prometheus",
			autoInvestigate: true,
		});
		expect(res).toEqual({
			received: 1,
			processed: 1,
			alertIds: ["a1"],
		});
	});

	it("checks Alertmanager after the delivery without waiting for it (#605)", async () => {
		alertPull.onWebhook.mockReturnValue(new Promise(() => {}));
		const service = {
			processPrometheusAlert: vi.fn(async () => ({ alertId: "a1", isNew: true })),
		};
		const res = await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});
		expect(alertPull.onWebhook).toHaveBeenCalledTimes(1);
		expect(res).toEqual({ received: 1, processed: 1, alertIds: ["a1"] });
	});

	it("handles errors thrown by processPrometheusAlert gracefully", async () => {
		const service = {
			processPrometheusAlert: vi
				.fn()
				.mockRejectedValueOnce(new Error("Database error"))
				.mockResolvedValueOnce({ alertId: "a2", isNew: true }),
		};
		const res = await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing, { ...firing, fingerprint: "fp-2" }] },
			context: {},
		});
		expect(res).toEqual({
			received: 2,
			processed: 1,
			alertIds: ["a2"],
		});
	});
});
