// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { ChangeEventsService } from "./change-events.service.js";
import { ChangesController } from "./changes.controller.js";

@Module({
	imports: [PrismaModule, HarnessModule, IntegrationsModule],
	controllers: [ChangesController],
	providers: [ChangeEventsService],
	exports: [ChangeEventsService],
})
export class ChangesModule {}
