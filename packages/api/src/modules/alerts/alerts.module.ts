// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { CorrelationModule } from "../correlation/correlation.module.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";

@Module({
	imports: [
		forwardRef(() => CorrelationModule),
		// QueueModule is @Global, no need to import - QueueService is available globally
	],
	controllers: [AlertsController],
	providers: [AlertsService],
	exports: [AlertsService],
})
export class AlertsModule {}
