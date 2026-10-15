// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { CaseFilesModule } from "../../modules/case-files/case-files.module.js";
import { IntegrationsModule } from "../../modules/integrations/integrations.module.js";
import { HarnessModule } from "../harness/harness.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AboutService } from "./about.service.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
	imports: [
		PrismaModule,
		HarnessModule,
		forwardRef(() => IntegrationsModule),
		CaseFilesModule,
	],
	controllers: [SettingsController],
	providers: [SettingsService, AboutService],
	exports: [SettingsService],
})
export class SettingsModule {}
