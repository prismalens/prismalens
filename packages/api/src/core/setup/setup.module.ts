// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { UsersModule } from "../users/users.module.js";
import { SetupController } from "./setup.controller.js";

@Module({
	imports: [UsersModule, PrismaModule],
	controllers: [SetupController],
})
export class SetupModule {}
