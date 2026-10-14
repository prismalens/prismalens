// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { CaseFileSettingsService } from "./case-file-settings.service.js";

/** Case File experiment (Setting `case_file`, off by default). Must never import DispatchModule. */
@Module({
	imports: [PrismaModule],
	providers: [CaseFileSettingsService],
	exports: [CaseFileSettingsService],
})
export class CaseFilesModule {}
