// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { GatewayController } from "./gateway.controller.js";
import { GatewayService } from "./gateway.service.js";

/** PrismaLens's own read-only tools, delivered into every run (#848). */
@Module({
	imports: [PrismaModule],
	controllers: [GatewayController],
	providers: [GatewayService],
	exports: [GatewayService],
})
export class GatewayModule {}
