// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { RunWorkspacesController } from "./run-workspaces.controller.js";
import { RunWorkspacesService } from "./run-workspaces.service.js";

@Module({
	imports: [PrismaModule],
	controllers: [RunWorkspacesController],
	providers: [RunWorkspacesService],
	exports: [RunWorkspacesService],
})
export class RunWorkspacesModule {}
