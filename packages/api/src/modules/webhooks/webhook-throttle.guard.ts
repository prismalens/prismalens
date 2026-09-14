// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ExecutionContext,
	Injectable,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import type { Response } from "express";

/**
 * Over the limit a webhook answers 503 with a standard Retry-After, not 429: Alertmanager
 * retries 5xx and drops 429 (#637 edge 9), so a storm is delayed instead of lost.
 */
@Injectable()
export class WebhookThrottleGuard extends ThrottlerGuard {
	protected override async throwThrottlingException(
		context: ExecutionContext,
		detail: ThrottlerLimitDetail,
	): Promise<void> {
		context
			.switchToHttp()
			.getResponse<Response>()
			.header("Retry-After", String(Math.max(1, detail.timeToBlockExpire)));
		throw new ServiceUnavailableException(
			"Webhook rate limit reached; retry later",
		);
	}
}
