// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { UsersModule } from "../../core/users/users.module.js";
import { DevSeedService } from "./dev-seed.service.js";

@Module({
	imports: [UsersModule, PrismaModule],
	providers: [DevSeedService],
	exports: [DevSeedService],
})
export class DevSeedModule {}
