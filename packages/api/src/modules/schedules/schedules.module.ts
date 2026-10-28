// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { DispatchModule } from "../../infrastructure/dispatch/dispatch.module.js";
import { SchedulesController } from "./schedules.controller.js";
import { SchedulesService } from "./schedules.service.js";

@Module({
	imports: [DispatchModule, HarnessModule],
	controllers: [SchedulesController],
	providers: [SchedulesService],
})
export class SchedulesModule {}
