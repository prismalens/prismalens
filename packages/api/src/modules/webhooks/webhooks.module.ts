import { forwardRef, Module } from "@nestjs/common";
import { AlertMappingModule } from "../alert-mapping/alert-mapping.module.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { CorrelationModule } from "../correlation/correlation.module.js";
import { EventsModule } from "../events/events.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

@Module({
	imports: [
		forwardRef(() => AlertsModule),
		EventsModule,
		forwardRef(() => CorrelationModule),
		AlertMappingModule,
		IntegrationsModule,
	],
	controllers: [WebhooksController],
	providers: [WebhooksService],
	exports: [WebhooksService],
})
export class WebhooksModule {}
