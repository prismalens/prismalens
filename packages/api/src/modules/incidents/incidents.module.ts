import { forwardRef, Module } from "@nestjs/common";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { IncidentsController } from "./incidents.controller.js";
import { IncidentsService } from "./incidents.service.js";

@Module({
	imports: [
		forwardRef(() => InvestigationsModule),
		forwardRef(() => TimelineModule),
		// QueueModule is @Global, no need to import - QueueService is available globally
	],
	controllers: [IncidentsController],
	providers: [IncidentsService],
	exports: [IncidentsService],
})
export class IncidentsModule {}
