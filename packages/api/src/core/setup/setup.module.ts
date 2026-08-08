// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { UsersModule } from "../users/users.module.js";
import { SetupController } from "./setup.controller.js";

@Module({
	// SettingsModule provides LlmSettingsService — the setup status reads
	// provider readiness through it rather than re-deriving credential storage
	// (D11: one credential path, the app vault).
	imports: [UsersModule, PrismaModule, forwardRef(() => SettingsModule)],
	controllers: [SetupController],
})
export class SetupModule {}
