import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../core/prisma/prisma.service.js";

/** Default max change events to return per query */
const DEFAULT_LIMIT = 50;

@Injectable()
export class ChangeEventsService {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Find change events for an incident's service within an optional time range.
	 * Looks up the incident's serviceId first, then queries change events for that service.
	 */
	async findByIncident(
		incidentId: string,
		timeRange?: { start: Date; end: Date },
		limit = DEFAULT_LIMIT,
	) {
		const incident = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			select: { serviceId: true },
		});
		if (!incident?.serviceId) return [];

		return this.prisma.changeEvent.findMany({
			where: {
				serviceId: incident.serviceId,
				...(timeRange && {
					timestamp: { gte: timeRange.start, lte: timeRange.end },
				}),
			},
			orderBy: { timestamp: "desc" },
			take: limit,
		});
	}
}
