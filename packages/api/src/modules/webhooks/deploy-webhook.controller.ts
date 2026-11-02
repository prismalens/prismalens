// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { webhooksContract } from "@prismalens/contracts";
import { Public } from "../../core/auth/public.decorator.js";
import { DeployEventsService } from "../changes/deploy-events.service.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhookThrottleGuard } from "./webhook-throttle.guard.js";

/** Deploy events from CI (#854), behind the same webhook secret as every other sender. */
@Public()
@Controller()
@UseGuards(WebhookThrottleGuard, WebhookSignatureGuard)
@Throttle({
	short: { ttl: 1000, limit: 20 },
	medium: { ttl: 60000, limit: 600 },
})
export class DeployWebhookController {
	constructor(private readonly deploys: DeployEventsService) {}

	@Implement(webhooksContract.deploy)
	deploy() {
		return implement(webhooksContract.deploy).handler(async ({ input }) => {
			const result = await this.deploys.record(input);
			if (!result)
				throw new ORPCError("NOT_FOUND", {
					message: `No service named "${input.service}". Names are listed under Services.`,
				});
			return result;
		});
	}
}
