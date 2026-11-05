// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { ThreadsController } from "./threads.controller.js";
import { ThreadsService } from "./threads.service.js";

/** Project, service and no-subject threads (#1020); DispatchModule is global. */
@Module({
	imports: [InvestigationsModule, HarnessModule, IntegrationsModule],
	controllers: [ThreadsController],
	providers: [ThreadsService],
})
export class ThreadsModule {}
