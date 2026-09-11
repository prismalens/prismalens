// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { HarnessService } from "./harness.service.js";
import { RepoCloneService } from "./repo-clone.service.js";

@Module({
	imports: [PrismaModule],
	providers: [HarnessService, RepoCloneService],
	exports: [HarnessService, RepoCloneService],
})
export class HarnessModule {}
