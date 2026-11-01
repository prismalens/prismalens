// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { PushController } from "./push.controller.js";
import { PushService } from "./push.service.js";

@Module({
	controllers: [PushController],
	providers: [
		{
			provide: PushService,
			useFactory: (prisma: PrismaService) => new PushService(prisma),
			inject: [PrismaService],
		},
	],
	exports: [PushService],
})
export class PushModule {}
