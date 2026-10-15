// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { BindingsService } from "./bindings.service.js";
import { CaptureService } from "./capture.service.js";
import { CaseBuilder } from "./case-builder.js";
import { CaseBundleService } from "./case-bundle.service.js";
import { CaseFileSettingsService } from "./case-file-settings.service.js";
import { CaseFilesController } from "./case-files.controller.js";
import { CaseViewService } from "./case-view.service.js";
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
		CaseBuilder,
		CaptureService,
		CaseBundleService,
		CaseViewService,
	],
	exports: [
		CaseFileSettingsService,
		ArtifactStore,
		ManifestService,
		CaptureService,
		CaseBundleService,
	],
})
export class CaseFilesModule {}
