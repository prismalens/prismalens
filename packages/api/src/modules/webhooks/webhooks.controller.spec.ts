// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ThrottlerGuard } from "@nestjs/throttler";
import { describe, expect, it } from "vitest";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhooksController } from "./webhooks.controller.js";

describe("WebhooksController guards (#637 edge 9)", () => {
	it("authenticates every delivery and never throttles one, since Alertmanager does not retry a 429", () => {
		const guards = Reflect.getMetadata(GUARDS_METADATA, WebhooksController);
		expect(guards).toEqual([WebhookSignatureGuard]);
		expect(guards).not.toContain(ThrottlerGuard);
	});
});
