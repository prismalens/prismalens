// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Module } from "@nestjs/common";
import { HarnessModule } from "../harness/harness.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SetupController } from "./setup.controller.js";

@Module({
	// HarnessModule provides the harness selection the on-ramp status reads.
	imports: [PrismaModule, forwardRef(() => HarnessModule)],
	controllers: [SetupController],
})
export class SetupModule {}
