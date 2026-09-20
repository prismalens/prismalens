// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import type { ConnectorProvider, ResolvedConnector } from "@prismalens/engine";
import { createAdapter, getAdapterSegments } from "@prismalens/integrations";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "./integrations.service.js";

const SUPPORTED_TEMPLATES = new Set(["prometheus", "alertmanager"]);

@Injectable()
export class ConnectorResolverService implements ConnectorProvider {
	private readonly logger = new Logger(ConnectorResolverService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly integrationsService: IntegrationsService,
	) {}

	async resolve(ctx: { serviceId?: string }): Promise<ResolvedConnector[]> {
		const results: ResolvedConnector[] = [];
		const seenTemplates = new Set<string>();

		if (ctx.serviceId) {
			const serviceIntegrations =
				await this.integrationsService.findServiceIntegrations(ctx.serviceId);

			for (const si of serviceIntegrations) {
				const conn = si.connection;
				const templateId = conn.integration.templateId;
				if (!SUPPORTED_TEMPLATES.has(templateId)) continue;
				if (conn.status !== "ACTIVE") continue;
				if (seenTemplates.has(templateId)) continue;

				const baseUrl = await this.integrationsService.connectionBaseUrl(
					conn.id,
				);
				if (!baseUrl) {
					this.logger.warn(
						`Connection ${conn.id} for template '${templateId}' has no baseUrl — skipping`,
					);
					continue;
				}

				const adapter = createAdapter(templateId);
				const segments = adapter ? getAdapterSegments(adapter) : [];

				results.push({
					templateId,
					connectionId: conn.id,
					label: conn.label || conn.integration.label || templateId,
					baseUrl,
					segments,
				});
				seenTemplates.add(templateId);
			}
		}

		const globalActiveConnections = await this.prisma.connection.findMany({
			where: { status: "ACTIVE" },
			include: { integration: true },
		});

		for (const conn of globalActiveConnections) {
			const templateId = conn.integration.templateId;
			if (!SUPPORTED_TEMPLATES.has(templateId)) continue;
			if (seenTemplates.has(templateId)) continue;

			const baseUrl = await this.integrationsService.connectionBaseUrl(conn.id);
			if (!baseUrl) {
				this.logger.warn(
					`Connection ${conn.id} for template '${templateId}' has no baseUrl — skipping`,
				);
				continue;
			}

			const adapter = createAdapter(templateId);
			const segments = adapter ? getAdapterSegments(adapter) : [];

			results.push({
				templateId,
				connectionId: conn.id,
				label: conn.label || conn.integration.label || templateId,
				baseUrl,
				segments,
			});
			seenTemplates.add(templateId);
		}

		return results;
	}
}
