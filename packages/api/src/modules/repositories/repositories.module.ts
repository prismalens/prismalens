// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { ImagesModule } from "../images/images.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { RepositoriesController } from "./repositories.controller.js";
import { RepositoriesService } from "./repositories.service.js";
import { RepositoryIconService } from "./repository-icon.service.js";

@Module({
	imports: [PrismaModule, HarnessModule, IntegrationsModule, ImagesModule],
	controllers: [RepositoriesController],
	providers: [RepositoriesService, RepositoryIconService],
	exports: [RepositoriesService, RepositoryIconService],
})
export class RepositoriesModule {}
