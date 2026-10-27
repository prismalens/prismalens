// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { HarnessService } from "./harness.service.js";
import { HarnessModelsService } from "./harness-models.service.js";
import { HarnessProbeService } from "./harness-probe.service.js";
import { RepoSourceService } from "./repo-source.service.js";

@Module({
	imports: [PrismaModule, ConfigModule],
	providers: [
		CredentialsService,
		HarnessService,
		RepoSourceService,
		HarnessProbeService,
		HarnessModelsService,
	],
	exports: [
		HarnessService,
		RepoSourceService,
		HarnessProbeService,
		HarnessModelsService,
	],
})
export class HarnessModule {}
