// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AlertMappingModule } from "../alert-mapping/alert-mapping.module.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { ChangesModule } from "../changes/changes.module.js";
import { EventsModule } from "../events/events.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { DeployWebhookController } from "./deploy-webhook.controller.js";
import { RenderWebhookSignatureGuard } from "./render-webhook-signature.guard.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

@Module({
	imports: [
		ConfigModule,
		forwardRef(() => AlertsModule),
		EventsModule,
		AlertMappingModule,
		IntegrationsModule,
		ChangesModule,
	],
	controllers: [WebhooksController, DeployWebhookController],
	providers: [
		WebhooksService,
		WebhookSignatureGuard,
		RenderWebhookSignatureGuard,
	],
	exports: [WebhooksService],
})
export class WebhooksModule {}
