// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { ImpactModule } from "../impact/impact.module.js";
import { FixesController } from "./fixes.controller.js";
import { FixesService } from "./fixes.service.js";

@Module({
	imports: [PrismaModule, ImpactModule],
	controllers: [FixesController],
	providers: [FixesService],
})
export class FixesModule {}
