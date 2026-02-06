import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { IntegrationsModule } from "../../modules/integrations/integrations.module.js";
import { InvestigationsModule } from "../../modules/investigations/investigations.module.js";
import { TimelineModule } from "../../modules/timeline/timeline.module.js";
import { InternalGuard } from "./guards/internal.guard.js";
import { InternalIntegrationsController } from "./internal-integrations.controller.js";
import { InternalInvestigationsController } from "./internal-investigations.controller.js";
import { InternalTimelineController } from "./internal-timeline.controller.js";

@Module({
	imports: [ConfigModule, InvestigationsModule, TimelineModule, IntegrationsModule],
	controllers: [
		InternalInvestigationsController,
		InternalIntegrationsController,
		InternalTimelineController,
	],
	providers: [InternalGuard],
})
export class InternalModule {}
