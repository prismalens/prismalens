import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { InternalGuard } from "../../infrastructure/internal/guards/internal.guard.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";

@Module({
	imports: [ConfigModule, forwardRef(() => TimelineModule)],
	controllers: [InvestigationsController],
	providers: [InvestigationsService, InternalGuard],
	exports: [InvestigationsService],
})
export class InvestigationsModule {}
