// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { ImagesModule } from "../images/images.module.js";
import { THREAD_WATCHES } from "../gateway/tools/watches.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { WORK_ITEMS } from "../references/work-items.provider.js";
import { RunWorkspacesModule } from "../run-workspaces/run-workspaces.module.js";
import { LinksService } from "./links.service.js";
import { PullRequestsService } from "./pull-requests.service.js";
import { ThreadContextService } from "./thread-context.service.js";
import { ThreadContextSettingsController } from "./thread-context-settings.controller.js";
import { ThreadWatchesService } from "./thread-watches.service.js";
import { ThreadsController } from "./threads.controller.js";
import { ThreadsService } from "./threads.service.js";

/** Project, service and no-subject threads (#1020); DispatchModule is global. */
@Module({
	imports: [
		InvestigationsModule,
		HarnessModule,
		IntegrationsModule,
		RunWorkspacesModule,
		ImagesModule,
	],
	controllers: [ThreadsController, ThreadContextSettingsController],
	providers: [
		ThreadsService,
		PullRequestsService,
		ThreadContextService,
		LinksService,
		ThreadWatchesService,
		{ provide: THREAD_WATCHES, useExisting: ThreadWatchesService },
		{ provide: WORK_ITEMS, useExisting: PullRequestsService },
	],
	exports: [
		PullRequestsService,
		ThreadsService,
		ThreadWatchesService,
		THREAD_WATCHES,
		WORK_ITEMS,
	],
})
export class ThreadsModule {}
