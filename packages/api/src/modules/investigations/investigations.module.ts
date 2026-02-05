import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { InternalGuard } from "../../infrastructure/internal/guards/internal.guard.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { InvestigationTriggerService } from "./investigation-trigger.service.js";
import { InvestigationUpdateService } from "./investigation-update.service.js";
import { ProgressService } from "./progress.service.js";

@Module({
	imports: [ConfigModule, forwardRef(() => TimelineModule)],
	controllers: [InvestigationsController],
	providers: [
		InvestigationsService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		ProgressService,
		InternalGuard,
	],
	exports: [
		InvestigationsService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		ProgressService,
	],
})
export class InvestigationsModule {}
