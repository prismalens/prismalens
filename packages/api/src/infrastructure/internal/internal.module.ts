import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SettingsModule } from "../../core/settings/settings.module.js";
import { InvestigationsModule } from "../../modules/investigations/investigations.module.js";
import { TimelineModule } from "../../modules/timeline/timeline.module.js";
import { InternalGuard } from "./guards/internal.guard.js";
import { InternalInvestigationsController } from "./internal-investigations.controller.js";
import { InternalSettingsController } from "./internal-settings.controller.js";
import { InternalTimelineController } from "./internal-timeline.controller.js";

@Module({
	imports: [ConfigModule, SettingsModule, InvestigationsModule, TimelineModule],
	controllers: [
		InternalSettingsController,
		InternalInvestigationsController,
		InternalTimelineController,
	],
	providers: [InternalGuard],
})
export class InternalModule {}
