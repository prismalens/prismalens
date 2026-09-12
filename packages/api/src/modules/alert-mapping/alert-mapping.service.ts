// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import type { Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";

export interface AlertInfo {
	source?: string;
	labels?: Record<string, string>;
	tags?: string[];
	title: string;
	description?: string;
}

/**
 * The rule editor, the health report and the "Alert mapping issues" card are
 * deferred along with the correlation module (prismalens/prismalens#608, C5 on
 * #337). Intake keeps exactly one lookup: an exact match of the alert's
 * `service` label against `Service.name`. No rule table, no priority order,
 * no configurability.
 */
@Injectable()
export class AlertMappingService {
	private readonly logger = new Logger(AlertMappingService.name);

	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Resolve which service an alert belongs to from its `service` label.
	 * Returns null when the alert carries no `service` label, or when the
	 * label's value does not exactly match any `Service.name`.
	 */
	async resolveServiceForAlert(alert: AlertInfo): Promise<Service | null> {
		const serviceLabel = alert.labels?.service;
		if (!serviceLabel) return null;

		const service = await this.prisma.service.findUnique({
			where: { name: serviceLabel },
		});

		if (service) {
			this.logger.debug(
				`Alert "${alert.title}" mapped to service "${service.name}" by exact label match`,
			);
		} else {
			this.logger.debug(
				`Alert "${alert.title}" carries service label "${serviceLabel}" but no service has that name`,
			);
		}

		return service;
	}
}
