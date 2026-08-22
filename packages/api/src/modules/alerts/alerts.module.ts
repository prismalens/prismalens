// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CorrelationModule } from "../correlation/correlation.module.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";

@Module({
	imports: [
		// AlertsService reads the #231 flap window from config.
		ConfigModule,
		forwardRef(() => CorrelationModule),
		// DispatchModule is @Global, no need to import - DispatchService is available globally
	],
	controllers: [AlertsController],
	providers: [AlertsService],
	exports: [AlertsService],
})
export class AlertsModule {}
