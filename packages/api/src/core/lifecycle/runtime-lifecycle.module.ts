// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Global, Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AdmissionService } from "./admission.service.js";
import { RuntimeLifecycleService } from "./runtime-lifecycle.service.js";

/** Global so dispatch and the scheduler can subscribe without importing this module. */
@Global()
@Module({
	providers: [
		{
			provide: RuntimeLifecycleService,
			useFactory: (prisma: PrismaService) =>
				new RuntimeLifecycleService(prisma),
			inject: [PrismaService],
		},
		AdmissionService,
	],
	exports: [RuntimeLifecycleService, AdmissionService],
})
export class RuntimeLifecycleModule {}
