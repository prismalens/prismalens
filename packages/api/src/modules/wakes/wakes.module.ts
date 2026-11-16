// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Global, Module } from "@nestjs/common";
import { HarnessModule } from "../../core/harness/harness.module.js";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { InboxService } from "./inbox.service.js";
import { SessionLifecycleService } from "./session-lifecycle.service.js";
import { WakesService } from "./wakes.service.js";

/** Wakes and the session lifecycle (#1024); global because schedules and investigations reach it. */
@Global()
@Module({
	imports: [
		PrismaModule,
		HarnessModule,
		forwardRef(() => InvestigationsModule),
	],
	providers: [WakesService, SessionLifecycleService, InboxService],
	exports: [WakesService, SessionLifecycleService, InboxService],
})
export class WakesModule {}
