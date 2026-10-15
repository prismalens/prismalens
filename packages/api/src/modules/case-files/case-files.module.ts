// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { BindingsService } from "./bindings.service.js";
import { CaseFileSettingsService } from "./case-file-settings.service.js";
import { CaseFilesController } from "./case-files.controller.js";
import { ArtifactStore } from "./storage/artifact-store.js";
import { ManifestService } from "./storage/manifest.js";

/** Case File experiment (Setting `case_file`, off by default). Must never import DispatchModule. */
@Module({
	imports: [PrismaModule, IntegrationsModule],
	controllers: [CaseFilesController],
	providers: [
		CaseFileSettingsService,
		ArtifactStore,
		ManifestService,
		BindingsService,
	],
	exports: [CaseFileSettingsService, ArtifactStore, ManifestService],
})
export class CaseFilesModule {}
