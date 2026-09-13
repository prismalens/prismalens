// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { RepositoriesController } from "./repositories.controller.js";
import { RepositoriesService } from "./repositories.service.js";

@Module({
	imports: [PrismaModule, HarnessModule, IntegrationsModule],
	controllers: [RepositoriesController],
	providers: [RepositoriesService],
	exports: [RepositoriesService],
})
export class RepositoriesModule {}
