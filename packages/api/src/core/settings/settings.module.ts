// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { IntegrationsModule } from "../../modules/integrations/integrations.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { LlmSettingsService } from "./llm-settings.service.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
	imports: [PrismaModule, forwardRef(() => IntegrationsModule)],
	controllers: [SettingsController],
	providers: [SettingsService, LlmSettingsService],
	exports: [SettingsService, LlmSettingsService],
})
export class SettingsModule {}
