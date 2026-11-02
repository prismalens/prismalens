// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { timelineContract } from "@prismalens/contracts";
import type {
	TimelineEntry,
	TimelineEntryWithRelations,
} from "@prismalens/contracts/schemas";
import {
	holdsRemoved,
	shownAddress,
	shownText,
	UNSHOWN_REPO,
} from "../../core/harness/git-credential.js";
import type { CreateTimelineEntryDto } from "./dto/index.js";
import { TimelineService } from "./timeline.service.js";

function shownRepoEntry(r: { url: string; name?: unknown }, i: number) {
	const url = shownAddress(r.url);
	return url === UNSHOWN_REPO ||
		(typeof r.name === "string" && holdsRemoved(r.url, r.name))
		? { ...r, url, name: `repo-${i + 1}` }
		: { ...r, url };
}

/** A run's start entry names its repositories; rows written before #938 kept the stored address. */
export function shownMetadata(type: string, meta: unknown): unknown {
	if (type !== "investigation_started" || !meta || typeof meta !== "object")
		return meta;
	const m = meta as Record<string, unknown>;
	return {
		...m,
		...(typeof m.repo === "string" ? { repo: shownAddress(m.repo) } : {}),
		...(Array.isArray(m.repos)
			? {
					repos: m.repos.map((r: unknown, i: number) =>
						r &&
						typeof r === "object" &&
						typeof (r as { url?: unknown }).url === "string"
							? shownRepoEntry(r as { url: string }, i)
							: r,
					),
				}
			: {}),
	};
}

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

	private serializeTimelineEntry(entry: Record<string, any>): TimelineEntry {
		return {
			...entry,
			...(entry.type === "investigation_started" &&
			typeof entry.description === "string"
				? { description: shownText(entry.description) }
				: {}),
			metadata: entry.metadata
				? shownMetadata(entry.type, JSON.parse(entry.metadata))
				: null,
			occurredAt: entry.occurredAt?.toISOString(),
		} as TimelineEntry;
	}

	private serializeTimelineEntryWithRelations(
		entry: Record<string, any>,
	): TimelineEntryWithRelations {
		const serialized = this.serializeTimelineEntry(entry) as any;

		if (entry.user) {
			serialized.user = {
				id: entry.user.id,
				email: entry.user.email,
				firstName: entry.user.firstName ?? null,
				lastName: entry.user.lastName ?? null,
			};
		}

		return serialized as TimelineEntryWithRelations;
	}
}
