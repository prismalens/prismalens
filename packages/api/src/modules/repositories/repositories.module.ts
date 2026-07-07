// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { RepositoriesController } from "./repositories.controller.js";
import { RepositoriesService } from "./repositories.service.js";

@Module({
	imports: [PrismaModule],
	controllers: [RepositoriesController],
	providers: [RepositoriesService],
	exports: [RepositoriesService],
})
export class RepositoriesModule {}
