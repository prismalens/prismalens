// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Implement, implement } from "@orpc/nest";
import { settingsContract } from "@prismalens/contracts";
import { ReportDeliveryService } from "./report-delivery.service.js";

@UseGuards(ThrottlerGuard)
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
			update: implement(settingsContract.delivery.update).handler(({ input }) =>
				this.delivery.setSlackWebhook(input.slackWebhookUrl),
			),
		};
	}
}
