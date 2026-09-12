// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { IncidentsModule } from "../incidents/incidents.module.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";
import { IncidentCorrelationService } from "./incident-correlation.service.js";

@Module({
	imports: [
		// AlertsService reads the #231 flap window from config.
		ConfigModule,
		IncidentsModule,
		// DispatchModule is @Global, no need to import - DispatchService is available globally
	],
	controllers: [AlertsController],
	providers: [AlertsService, IncidentCorrelationService],
	exports: [AlertsService, IncidentCorrelationService],
})
export class AlertsModule {}
