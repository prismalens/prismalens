// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Global, Module } from "@nestjs/common";
import { SettingsModule } from "../../core/settings/settings.module.js";
import { IncidentsModule } from "../../modules/incidents/incidents.module.js";
import { IntegrationsModule } from "../../modules/integrations/integrations.module.js";
import { InvestigationsModule } from "../../modules/investigations/investigations.module.js";
import { ServicesModule } from "../../modules/services/services.module.js";
import { TimelineModule } from "../../modules/timeline/timeline.module.js";
import { DispatchService } from "./dispatch.service.js";
import { EventBusModule } from "./event-bus.module.js";

/**
 * Dispatch — the in-process JobStore/EventBus wiring that replaced BullMQ and Redis,
 * and (0005 §2) the forked `@prismalens/worker` too: the run itself now happens
 * in-process, through {@link RunPorts} built from the injected services below.
 *
 * There is no external service in this path and no other process — the job table
 * lives in the application database, the relay and the cancel channel are
 * in-process. `pnpm dev` needs no broker and forks nothing to start.
 *
 * Global because `DispatchService` is reached from several feature modules.
 */
@Global()
@Module({
	imports: [
		EventBusModule,
		forwardRef(() => InvestigationsModule),
		forwardRef(() => IncidentsModule),
		TimelineModule,
		IntegrationsModule,
		SettingsModule,
		ServicesModule,
	],
	providers: [DispatchService],
	exports: [DispatchService],
})
export class DispatchModule {}
