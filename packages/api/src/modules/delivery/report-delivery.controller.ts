// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { settingsContract } from "@prismalens/contracts";
import { requireOwner } from "../../core/auth/owner.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { ReportDeliveryService } from "./report-delivery.service.js";

@UseGuards(MutationThrottleGuard)
@Controller()
export class ReportDeliveryController {
	constructor(private readonly delivery: ReportDeliveryService) {}

	/** Slack report delivery (#606) */
	@Implement(settingsContract.delivery)
	deliverySettings() {
		return {
			get: implement(settingsContract.delivery.get).handler(() =>
				this.delivery.getSettings(),
			),
			update: implement(settingsContract.delivery.update).handler(
				({ input, context }) => {
					requireOwner(
						context.request,
						"Only the owner can change report delivery.",
					);
					return this.delivery.setSlackWebhook(input.slackWebhookUrl);
				},
			),
		};
	}
}
