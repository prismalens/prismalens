// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { openSource } from "../integrations/open-source.js";
import {
	MONITORING_REQUEST,
	monitoringProviders,
} from "../references/monitoring.provider.js";
import { REFERENCE_PROVIDERS } from "../references/reference-provider.js";
import { ReferencesService } from "../references/references.service.js";
import {
	DraftsController,
	ReferencesController,
} from "./composer.controller.js";
import { DraftsService } from "./drafts.service.js";

/** Composer drafts and the reference search (#1024); PrismaModule is global. */
@Module({
	imports: [IntegrationsModule],
	controllers: [DraftsController, ReferencesController],
	providers: [
		DraftsService,
		ReferencesService,
		{
			// Live Alertmanager and Prometheus items under `@`, through their stored credentials (#1024 spec B).
			provide: REFERENCE_PROVIDERS,
			inject: [PrismaService, IntegrationsService],
			useFactory: (prisma: PrismaService, integrations: IntegrationsService) =>
				monitoringProviders({
					connections: async (templateId) =>
						(
							await prisma.connection.findMany({
								where: { status: "ACTIVE", integration: { templateId } },
								select: { id: true, label: true },
							})
						).map((c) => ({ id: c.id, label: c.label || c.id })),
					open: (src) => openSource(integrations, src, MONITORING_REQUEST),
				}),
		},
	],
	exports: [DraftsService, ReferencesService],
})
export class ComposerModule {}
