// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { AlertMappingService } from "./alert-mapping.service.js";

@Module({
	imports: [PrismaModule],
	providers: [AlertMappingService],
	exports: [AlertMappingService],
})
export class AlertMappingModule {}
