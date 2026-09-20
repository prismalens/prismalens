// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Global, Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { TelemetryService } from "./telemetry.service.js";

/** Global so every module can report an event without importing this one. */
@Global()
@Module({
	providers: [
		{
			provide: TelemetryService,
			useFactory: (prisma: PrismaService) => new TelemetryService(prisma),
			inject: [PrismaService],
		},
	],
	exports: [TelemetryService],
})
export class TelemetryModule {}
