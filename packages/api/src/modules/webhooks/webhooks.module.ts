// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AlertMappingModule } from "../alert-mapping/alert-mapping.module.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { CorrelationModule } from "../correlation/correlation.module.js";
import { EventsModule } from "../events/events.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

@Module({
	imports: [
		ConfigModule,
		forwardRef(() => AlertsModule),
		EventsModule,
		forwardRef(() => CorrelationModule),
		AlertMappingModule,
		IntegrationsModule,
	],
	controllers: [WebhooksController],
	providers: [WebhooksService, WebhookSignatureGuard],
	exports: [WebhooksService],
})
export class WebhooksModule {}
