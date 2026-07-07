import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { InternalGuard } from "../../infrastructure/internal/guards/internal.guard.js";
import { OverlayModule } from "../overlay/overlay.module.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { InvestigationStreamController } from "./investigation-stream.controller.js";
import { InvestigationTriggerService } from "./investigation-trigger.service.js";
import { InvestigationUpdateService } from "./investigation-update.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { StreamRelayService } from "./stream-relay.service.js";

@Module({
	imports: [ConfigModule, forwardRef(() => TimelineModule), OverlayModule],
	controllers: [InvestigationsController, InvestigationStreamController],
	providers: [
		InvestigationsService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		StreamRelayService,
		InternalGuard,
	],
	exports: [
		InvestigationsService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		StreamRelayService,
	],
})
export class InvestigationsModule {}
