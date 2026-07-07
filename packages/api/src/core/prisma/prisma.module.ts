// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
	providers: [PrismaService],
	exports: [PrismaService], //export this service to use in other modules
})
export class PrismaModule {}
