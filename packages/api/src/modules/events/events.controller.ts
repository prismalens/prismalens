import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { eventsContract } from "@prismalens/contracts";
import type { Event } from "@prismalens/contracts/schemas";
import { EventsService } from "./events.service.js";

@Controller()
export class EventsController {
	constructor(private readonly eventsService: EventsService) {}

	@Implement(eventsContract)
	events() {
		return {
			// POST /events - Create a new event
			create: implement(eventsContract.create).handler(async ({ input }) => {
				const event = await this.eventsService.create(input);
				return this.serializeEvent(event);
			}),

			// GET /events - List events with filtering
			list: implement(eventsContract.list).handler(async ({ input }) => {
				const events = await this.eventsService.findAll({
					source: input.source,
					eventType: input.eventType,
					processed: input.processed,
					limit: input.limit,
					offset: input.offset,
				});
				return events.map((e) => this.serializeEvent(e));
			}),

			// GET /events/:id - Get a single event by ID
			get: implement(eventsContract.get).handler(async ({ input }) => {
				const event = await this.eventsService.findById(input.id);
				if (!event) {
					throw new ORPCError("NOT_FOUND", {
						message: `Event ${input.id} not found`,
					});
				}
				return this.serializeEvent(event);
			}),
		};
	}

	private serializeEvent(event: Record<string, any>): Event {
		return {
			...event,
			receivedAt: event.receivedAt?.toISOString(),
			eventTime: event.eventTime?.toISOString() ?? null,
		} as Event;
	}
}
