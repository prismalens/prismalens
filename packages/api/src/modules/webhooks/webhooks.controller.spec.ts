// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ExecutionContext } from "@nestjs/common";
import { ServiceUnavailableException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhookThrottleGuard } from "./webhook-throttle.guard.js";
import { WebhooksController } from "./webhooks.controller.js";
import type { WebhooksService } from "./webhooks.service.js";

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

describe("WebhooksController Prometheus intake (#633 edge 10)", () => {
	function prometheusHandler(service: Partial<WebhooksService>) {
		const controller = new WebhooksController(service as WebhooksService);
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

	it("resolves a late firing whose resolution already arrived", async () => {
		const service = {
			processGenericWebhook: vi.fn(async () => ({ alert: { id: "a1" } })),
			takeEarlyResolution: vi.fn(() => true),
			resolvePrometheusAlert: vi.fn(async () => null),
		};
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});
		expect(service.takeEarlyResolution).toHaveBeenCalledWith("fp-1", firing.startsAt);
		expect(service.resolvePrometheusAlert).toHaveBeenCalledWith("fp-1", undefined);
	});

	it("leaves an ordinary firing open", async () => {
		const service = {
			processGenericWebhook: vi.fn(async () => ({ alert: { id: "a1" } })),
			takeEarlyResolution: vi.fn(() => false),
			resolvePrometheusAlert: vi.fn(),
		};
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});
		expect(service.resolvePrometheusAlert).not.toHaveBeenCalled();
	});

	it("passes a resolution's startsAt so an unknown fingerprint can be remembered", async () => {
		const service = { resolvePrometheusAlert: vi.fn(async () => null) };
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [{ ...firing, status: "resolved" }] },
			context: {},
		});
		expect(service.resolvePrometheusAlert).toHaveBeenCalledWith(
			"fp-1",
			undefined,
			firing.startsAt,
		);
	});
});
