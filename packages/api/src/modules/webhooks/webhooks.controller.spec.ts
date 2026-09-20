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
			hasEarlyResolution: vi.fn(() => true),
			clearEarlyResolution: vi.fn(),
			resolvePrometheusAlert: vi.fn(async () => ({ id: "a1" })),
		};
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});
		expect(service.hasEarlyResolution).toHaveBeenCalledWith("fp-1", firing.startsAt);
		expect(service.resolvePrometheusAlert).toHaveBeenCalledWith("fp-1", undefined);
		expect(service.clearEarlyResolution).toHaveBeenCalledWith("fp-1", firing.startsAt);
	});

	it("leaves an ordinary firing open", async () => {
		const service = {
			processGenericWebhook: vi.fn(async () => ({ alert: { id: "a1" } })),
			hasEarlyResolution: vi.fn(() => false),
			clearEarlyResolution: vi.fn(),
			resolvePrometheusAlert: vi.fn(),
		};
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});
		expect(service.resolvePrometheusAlert).not.toHaveBeenCalled();
	});

	/**
	 * #664 review: the alert was created — and therefore correlated, and
	 * therefore auto-investigated — *before* anyone asked whether its
	 * resolution had already arrived. Every early-resolution episode on a
	 * policy-matching service burned a harness run that is never cancelled: it
	 * completes and is resolved microseconds later.
	 *
	 * The alert still has to be created (the resolve path finds it by
	 * fingerprint), so the fix is a create-without-dispatch flag, not a
	 * reordering of the two calls.
	 */
	it("records an early-resolved firing without dispatching a run", async () => {
		const service = {
			processGenericWebhook: vi.fn(
				async (
					_dto: unknown,
					_key?: string,
					_options?: { autoInvestigate?: boolean },
				) => ({ alert: { id: "a1" } }),
			),
			hasEarlyResolution: vi.fn(() => true),
			clearEarlyResolution: vi.fn(),
			resolvePrometheusAlert: vi.fn(async () => ({ id: "a1" })),
		};
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});

		// Still created, so the resolve path has something to resolve...
		expect(service.processGenericWebhook).toHaveBeenCalledTimes(1);
		// ...but explicitly told not to start anything.
		expect(service.processGenericWebhook.mock.calls[0][2]).toEqual({
			autoInvestigate: false,
		});
		// And the question was asked before the alert was created.
		const askedAt = service.hasEarlyResolution.mock.invocationCallOrder[0];
		const createdAt = service.processGenericWebhook.mock.invocationCallOrder[0];
		expect(askedAt).toBeLessThan(createdAt);
	});

	it("lets an ordinary firing dispatch as before", async () => {
		const service = {
			processGenericWebhook: vi.fn(
				async (
					_dto: unknown,
					_key?: string,
					_options?: { autoInvestigate?: boolean },
				) => ({ alert: { id: "a1" } }),
			),
			hasEarlyResolution: vi.fn(() => false),
			clearEarlyResolution: vi.fn(),
			resolvePrometheusAlert: vi.fn(),
		};
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});

		expect(service.processGenericWebhook.mock.calls[0][2]).toEqual({
			autoInvestigate: true,
		});
	});

	// #664 review: dropping the record before the resolution meant a failed
	// resolve lost it, and the retry left the alert open.
	it("keeps the early-resolution record when the resolution did not happen", async () => {
		const service = {
			processGenericWebhook: vi.fn(async () => ({ alert: { id: "a1" } })),
			hasEarlyResolution: vi.fn(() => true),
			clearEarlyResolution: vi.fn(),
			resolvePrometheusAlert: vi.fn(async () => null),
		};
		await prometheusHandler(service as unknown as Partial<WebhooksService>)({
			input: { alerts: [firing] },
			context: {},
		});
		expect(service.resolvePrometheusAlert).toHaveBeenCalled();
		expect(service.clearEarlyResolution).not.toHaveBeenCalled();
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
