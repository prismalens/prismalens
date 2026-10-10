// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { ChangesModule } from "../changes/changes.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { ImpactController } from "./impact.controller.js";
import { ImpactService } from "./impact.service.js";

@Module({
	imports: [PrismaModule, IntegrationsModule, ChangesModule],
	controllers: [ImpactController],
	providers: [ImpactService],
	exports: [ImpactService],
})
export class ImpactModule {}
