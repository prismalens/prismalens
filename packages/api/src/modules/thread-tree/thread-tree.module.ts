// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { GatewayModule } from "../gateway/gateway.module.js";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { RepositoriesModule } from "../repositories/repositories.module.js";
import { SchedulesModule } from "../schedules/schedules.module.js";
import { ThreadsModule } from "../threads/threads.module.js";
import { PendingActionsService } from "./pending-actions.service.js";
import { ProposalsService } from "./proposals.service.js";
import { ThreadTreeController } from "./thread-tree.controller.js";
import { ThreadTreeService } from "./thread-tree.service.js";
import { TreeGateway } from "./tree-gateway.js";
import { TreeIo } from "./tree-io.js";
import { TreeSettings } from "./tree-settings.js";

/** Threads that start threads (#1024 spec F); DispatchModule is global. */
@Module({
	imports: [
		PrismaModule,
		GatewayModule,
		InvestigationsModule,
		ThreadsModule,
		RepositoriesModule,
		SchedulesModule,
	],
	controllers: [ThreadTreeController],
	providers: [
		TreeSettings,
		TreeIo,
		PendingActionsService,
		ThreadTreeService,
		ProposalsService,
		TreeGateway,
	],
	exports: [ThreadTreeService, PendingActionsService],
})
export class ThreadTreeModule {}
