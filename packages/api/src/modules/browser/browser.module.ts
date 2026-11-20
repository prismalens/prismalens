// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { BROWSER_HOST } from "../gateway/tools/index.js";
import { InvestigationsModule } from "../investigations/investigations.module.js";
import { BrowserController } from "./browser.controller.js";
import { BrowserHostService } from "./browser-host.service.js";

/** The host browser beside each thread (#1061); the gateway reaches it through BROWSER_HOST. */
@Module({
	imports: [PrismaModule, InvestigationsModule],
	controllers: [BrowserController],
	providers: [
		BrowserHostService,
		{ provide: BROWSER_HOST, useExisting: BrowserHostService },
	],
	exports: [BrowserHostService, BROWSER_HOST],
})
export class BrowserModule {}
