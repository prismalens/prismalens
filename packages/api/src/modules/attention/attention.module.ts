// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { ThreadsModule } from "../threads/threads.module.js";
import { AttentionController } from "./attention.controller.js";
import { AttentionService } from "./attention.service.js";

/** Read state, presence, the away view and what notifies (#1101 categories 3 and 4). */
@Module({
	imports: [PrismaModule, InvestigationsModule, ThreadsModule],
	controllers: [AttentionController],
	providers: [AttentionService],
	exports: [AttentionService],
})
export class AttentionModule {}
