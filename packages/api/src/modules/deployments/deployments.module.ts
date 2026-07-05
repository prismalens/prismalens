// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { DeploymentsController } from "./deployments.controller.js";
import { DeploymentsService } from "./deployments.service.js";

@Module({
	imports: [PrismaModule],
	controllers: [DeploymentsController],
	providers: [DeploymentsService],
	exports: [DeploymentsService],
})
export class DeploymentsModule {}
