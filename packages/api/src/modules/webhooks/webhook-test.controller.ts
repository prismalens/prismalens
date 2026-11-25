// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { webhooksContract } from "@prismalens/contracts";
import type { Request } from "express";
import { operatorOnly } from "../../core/auth/pairing.controller.js";
import { WebhooksService } from "./webhooks.service.js";

/** Not `@Public()`: sending a test alert may start a run, so only the operator does it. */
@Controller()
export class WebhookTestController {
	constructor(private readonly webhooks: WebhooksService) {}

	@Implement(webhooksContract.sendTest)
	sendTest() {
		return implement(webhooksContract.sendTest).handler(
			async ({ input, context }) => {
				operatorOnly(context.request as Request);
				const result = await this.webhooks.sendTestAlert(input.serviceName);
				return {
					alertId: result.alert.id,
					incidentId: result.incidentId,
					incidentNumber: result.incidentNumber,
					isNewIncident: result.isNewIncident,
				};
			},
		);
	}
}
