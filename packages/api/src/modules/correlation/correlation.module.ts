// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { IncidentsModule } from "../incidents/incidents.module.js";
import { CorrelationController } from "./correlation.controller.js";
import { CorrelationService } from "./correlation.service.js";

@Module({
	imports: [forwardRef(() => IncidentsModule)],
	controllers: [CorrelationController],
	providers: [CorrelationService],
	exports: [CorrelationService],
})
export class CorrelationModule {}
