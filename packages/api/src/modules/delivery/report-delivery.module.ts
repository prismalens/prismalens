// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "../integrations/crypto/credentials.service.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { TimelineModule } from "../timeline/timeline.module.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { ReportDeliveryController } from "./report-delivery.controller.js";
import { ReportDeliveryService } from "./report-delivery.service.js";

@Module({
	imports: [IntegrationsModule, TimelineModule],
	controllers: [ReportDeliveryController],
	providers: [
		{
			provide: ReportDeliveryService,
			useFactory: (
				prisma: PrismaService,
				credentials: CredentialsService,
				timeline: TimelineService,
			) => new ReportDeliveryService(prisma, credentials, timeline),
			inject: [PrismaService, CredentialsService, TimelineService],
		},
	],
	exports: [ReportDeliveryService],
})
export class ReportDeliveryModule {}
