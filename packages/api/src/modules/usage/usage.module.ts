// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { HarnessModelsService } from "../../core/harness/harness-models.service.js";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { harnessLimitSource, LIMIT_SOURCE } from "./limit-reads.js";
import { UsageController } from "./usage.controller.js";
import { UsageService } from "./usage.service.js";

@Module({
	imports: [PrismaModule, HarnessModule],
	controllers: [UsageController],
	providers: [
		UsageService,
		{
			provide: LIMIT_SOURCE,
			useFactory: harnessLimitSource,
			inject: [HarnessService, HarnessModelsService],
		},
	],
})
export class UsageModule {}
