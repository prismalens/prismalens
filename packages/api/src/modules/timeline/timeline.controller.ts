import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { timelineContract } from "@prismalens/contracts";
import type { CreateTimelineEntryDto } from "./dto/index.js";
import { TimelineService } from "./timeline.service.js";

@Controller()
export class TimelineController {
	constructor(private readonly timelineService: TimelineService) {}

	@Implement(timelineContract)
	timeline() {
		return {
			// POST /timeline - Create a new timeline entry
			create: implement(timelineContract.create).handler(async ({ input }) => {
				const entry = await this.timelineService.create(
					input as unknown as CreateTimelineEntryDto,
				);
				return this.serializeTimelineEntry(entry);
			}),

			// GET /timeline - List timeline entries for an incident
			list: implement(timelineContract.list).handler(async ({ input }) => {
				const entries = await this.timelineService.findByIncidentId(
					input.incidentId,
					{
						type: input.type,
						limit: input.limit,
						offset: input.offset,
					},
				);
				return entries.map((e) => this.serializeTimelineEntryWithRelations(e));
			}),

			// GET /timeline/:id - Get a single timeline entry
			get: implement(timelineContract.get).handler(async ({ input }) => {
				const entry = await this.timelineService.findById(input.id);
				if (!entry) {
					throw new ORPCError("NOT_FOUND", {
						message: `Timeline entry ${input.id} not found`,
					});
				}
				return this.serializeTimelineEntryWithRelations(entry);
			}),

			// DELETE /timeline/:id - Delete a timeline entry
			delete: implement(timelineContract.delete).handler(async ({ input }) => {
				const deleted = await this.timelineService.delete(input.id);
				if (!deleted) {
					throw new ORPCError("NOT_FOUND", {
						message: `Timeline entry ${input.id} not found`,
					});
				}
			}),
		};
	}

	private serializeTimelineEntry(entry: any): any {
		return {
			...entry,
			metadata: entry.metadata ? JSON.parse(entry.metadata) : null,
			timestamp: entry.timestamp?.toISOString(),
			createdAt: entry.createdAt?.toISOString(),
		};
	}

	private serializeTimelineEntryWithRelations(entry: any): any {
		const serialized = this.serializeTimelineEntry(entry);

		if (entry.user) {
			serialized.user = {
				id: entry.user.id,
				email: entry.user.email,
				name: entry.user.name,
			};
		}

		return serialized;
	}
}
