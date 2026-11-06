// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { ReferencesService } from "../references/references.service.js";
import {
	DraftsController,
	ReferencesController,
} from "./composer.controller.js";
import { DraftsService } from "./drafts.service.js";

/** Composer drafts and the reference search (#1024); PrismaModule is global. */
@Module({
	controllers: [DraftsController, ReferencesController],
	providers: [DraftsService, ReferencesService],
	exports: [DraftsService, ReferencesService],
})
export class ComposerModule {}
