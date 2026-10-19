// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { GatewayController } from "./gateway.controller.js";
import { GatewayService } from "./gateway.service.js";

/** The read-only MCP gateway every launched agent reaches (#848). */
@Module({
	imports: [PrismaModule, IntegrationsModule],
	controllers: [GatewayController],
	providers: [GatewayService],
	exports: [GatewayService],
})
export class GatewayModule {}
