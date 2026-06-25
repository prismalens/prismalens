import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SettingsModule } from "../../core/settings/settings.module.js";
import { InternalGuard } from "../../infrastructure/internal/guards/internal.guard.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { InvestigationEngineService } from "./investigation-engine.service.js";
import { InvestigationStreamController } from "./investigation-stream.controller.js";
import { InvestigationTriggerService } from "./investigation-trigger.service.js";
import { InvestigationUpdateService } from "./investigation-update.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { ProgressService } from "./progress.service.js";
import { StreamRelayService } from "./stream-relay.service.js";

@Module({
	imports: [ConfigModule, SettingsModule, forwardRef(() => TimelineModule)],
	controllers: [InvestigationsController, InvestigationStreamController],
	providers: [
		InvestigationsService,
		InvestigationEngineService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		ProgressService,
		StreamRelayService,
		InternalGuard,
	],
	exports: [
		InvestigationsService,
		InvestigationEngineService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		ProgressService,
		StreamRelayService,
	],
})
export class InvestigationsModule {}
