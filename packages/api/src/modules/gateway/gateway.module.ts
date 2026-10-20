// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { GatewayController } from "./gateway.controller.js";
import { GatewayService } from "./gateway.service.js";
import { OAuthCallbackController } from "./oauth-callback.controller.js";
import { McpProxy, PROXY_PORT } from "./proxy/proxy.service.js";
import { SignIns } from "./sign-in.js";
import { SourcesController } from "./sources.controller.js";
import { SourcesService } from "./sources.service.js";

/** The read-only MCP gateway every launched agent reaches (#848). */
@Module({
	imports: [PrismaModule, IntegrationsModule],
	controllers: [GatewayController, SourcesController, OAuthCallbackController],
	providers: [
		GatewayService,
		SourcesService,
		SignIns,
		McpProxy,
		{ provide: PROXY_PORT, useExisting: McpProxy },
	],
	exports: [GatewayService, PROXY_PORT],
})
export class GatewayModule {}
