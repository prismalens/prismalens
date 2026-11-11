// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { CRON_JOBS } from "../gateway/tools/cron.js";
import { CronService } from "./cron.service.js";

/** A thread's cron jobs (#1024 surface F); WakesModule is global. */
@Module({
	imports: [PrismaModule],
	providers: [CronService, { provide: CRON_JOBS, useExisting: CronService }],
	exports: [CronService, CRON_JOBS],
})
export class CronModule {}
