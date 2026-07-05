// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../../core/auth/public.decorator.js";
import { TimelineService } from "../../modules/timeline/timeline.service.js";
import { TimelineSource } from "../../shared/enums/index.js";
import { CreateTimelineEntryDto } from "./dto/index.js";
import { InternalGuard } from "./guards/internal.guard.js";

/**
 * Internal API for timeline operations.
 * Used by the Python worker to add timeline entries in real-time.
 * Protected by InternalGuard (requires X-Internal-Secret header).
 * @Public() skips AuthGuard — InternalGuard handles auth via X-Internal-Secret.
 */
@Public()
@ApiExcludeController()
@Controller("internal/timeline")
@UseGuards(InternalGuard)
export class InternalTimelineController {
	constructor(private readonly timelineService: TimelineService) {}

	/**
	 * Create a timeline entry (real-time during investigation)
	 * Typically used for 'investigation_started' events
	 */
	@Post()
	@HttpCode(HttpStatus.CREATED)
	async addEntry(@Body() dto: CreateTimelineEntryDto) {
		return this.timelineService.create({
			incidentId: dto.incidentId,
			type: dto.type,
			title: dto.title,
			description: dto.description,
			metadata: dto.metadata,
			source: dto.source ?? TimelineSource.ai_worker,
		});
	}
}
