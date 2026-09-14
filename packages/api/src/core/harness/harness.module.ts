// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { HarnessService } from "./harness.service.js";
import { HarnessProbeService } from "./harness-probe.service.js";
import { RepoSourceService } from "./repo-source.service.js";

@Module({
	imports: [PrismaModule],
	providers: [HarnessService, RepoSourceService, HarnessProbeService],
	exports: [HarnessService, RepoSourceService, HarnessProbeService],
})
export class HarnessModule {}
