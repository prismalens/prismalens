// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { SettingsModule } from "../../core/settings/settings.module.js";
import { ASKS_PORT } from "../asks/asks.contract.js";
import { AsksService } from "../asks/asks.service.js";
import { ComposerModule } from "../composer/composer.module.js";
import { ReportDeliveryModule } from "../delivery/report-delivery.module.js";
import { TOOL_ASKS } from "../gateway/tools/asks.js";
import { IncidentsModule } from "../incidents/incidents.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { OverlayModule } from "../overlay/overlay.module.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { AttachmentsService } from "./attachments.service.js";
import { ContextPackService } from "./context-pack.service.js";
import { InvestigationStreamController } from "./investigation-stream.controller.js";
import { InvestigationTriggerService } from "./investigation-trigger.service.js";
import { InvestigationUpdateService } from "./investigation-update.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { StreamRelayService } from "./stream-relay.service.js";
import { ThreadSearchService } from "./thread-window/thread-search.service.js";
import { ThreadWindowService } from "./thread-window/thread-window.service.js";
import { ToolAsksService } from "./tool-asks.service.js";

@Module({
	imports: [
		ConfigModule,
		HarnessModule,
		forwardRef(() => TimelineModule),
		forwardRef(() => IncidentsModule),
		OverlayModule,
		SettingsModule,
		IntegrationsModule,
		ReportDeliveryModule,
		ComposerModule,
	],
	controllers: [InvestigationsController, InvestigationStreamController],
	providers: [
		InvestigationsService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		StreamRelayService,
		ContextPackService,
		AttachmentsService,
		ThreadWindowService,
		ThreadSearchService,
		AsksService,
		{ provide: ASKS_PORT, useExisting: AsksService },
		ToolAsksService,
		{ provide: TOOL_ASKS, useExisting: ToolAsksService },
	],
	exports: [
		AsksService,
		ASKS_PORT,
		ToolAsksService,
		TOOL_ASKS,
		ComposerModule,
		AttachmentsService,
		InvestigationsService,
		InvestigationTriggerService,
		InvestigationUpdateService,
		StreamRelayService,
		ContextPackService,
		ThreadWindowService,
		ThreadSearchService,
	],
})
export class InvestigationsModule {}
