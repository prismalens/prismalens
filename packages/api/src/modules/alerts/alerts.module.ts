// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { IncidentsModule } from "../incidents/incidents.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { WebhooksModule } from "../webhooks/webhooks.module.js";
import { AlertPullService } from "./alert-pull.service.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";
import { IncidentCorrelationService } from "./incident-correlation.service.js";

@Module({
	imports: [
		// AlertsService reads the #231 flap window from config.
		ConfigModule,
		IncidentsModule,
		forwardRef(() => WebhooksModule),
		forwardRef(() => IntegrationsModule),
		// DispatchModule is @Global, no need to import - DispatchService is available globally
	],
	controllers: [AlertsController],
	providers: [AlertsService, IncidentCorrelationService, AlertPullService],
	exports: [AlertsService, IncidentCorrelationService, AlertPullService],
})
export class AlertsModule {}
