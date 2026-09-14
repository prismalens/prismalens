// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ExecutionContext } from "@nestjs/common";
import { ServiceUnavailableException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhookThrottleGuard } from "./webhook-throttle.guard.js";
import { WebhooksController } from "./webhooks.controller.js";

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
