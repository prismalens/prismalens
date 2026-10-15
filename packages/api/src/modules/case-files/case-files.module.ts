// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CaseBuilder } from "./case-builder.js";
import { CaseFileSettingsService } from "./case-file-settings.service.js";
import { ArtifactStore } from "./storage/artifact-store.js";
import { ManifestService } from "./storage/manifest.js";

/** Case File experiment (Setting `case_file`, off by default). Must never import DispatchModule. */
@Module({
	imports: [PrismaModule, IntegrationsModule],
	providers: [
		CaseFileSettingsService,
		ArtifactStore,
		ManifestService,
		CaseBuilder,
	],
	exports: [
		CaseFileSettingsService,
		ArtifactStore,
		ManifestService,
		CaseBuilder,
	],
})
export class CaseFilesModule {}
