// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { SettingsModule } from "../../core/settings/settings.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { IncidentsController } from "./incidents.controller.js";
import { IncidentsService } from "./incidents.service.js";

@Module({
	imports: [
		forwardRef(() => InvestigationsModule),
		forwardRef(() => TimelineModule),
		IntegrationsModule,
		SettingsModule,
		// DispatchModule is @Global, no need to import - DispatchService is available globally
	],
	controllers: [IncidentsController],
	providers: [IncidentsService],
	exports: [IncidentsService],
})
export class IncidentsModule {}
