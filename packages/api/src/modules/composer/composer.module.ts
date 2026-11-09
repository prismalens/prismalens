// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
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
	WORK_ITEMS,
	WorkItemsProvider,
	type WorkItemsSource,
} from "../references/work-items.provider.js";
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
			// Live Alertmanager and Prometheus items under `@`, and the git hosts' work items under `#` (#1024 spec B).
			provide: REFERENCE_PROVIDERS,
			inject: [PrismaService, IntegrationsService, ModuleRef],
			useFactory: (
				prisma: PrismaService,
				integrations: IntegrationsService,
				refs: ModuleRef,
			) => [
				new WorkItemsProvider(() => {
					try {
						return refs.get<WorkItemsSource>(WORK_ITEMS, { strict: false });
					} catch {
						return null;
					}
				}),
				...monitoringProviders({
					connections: async (templateId) =>
						(
							await prisma.connection.findMany({
								where: { status: "ACTIVE", integration: { templateId } },
								select: { id: true, label: true },
							})
						).map((c) => ({ id: c.id, label: c.label || c.id })),
					open: (src) => openSource(integrations, src, MONITORING_REQUEST),
				}),
			],
		},
	],
	exports: [DraftsService, ReferencesService],
})
export class ComposerModule {}
