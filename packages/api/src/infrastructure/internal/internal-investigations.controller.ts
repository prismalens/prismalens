// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BadRequestException,
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Logger,
	NotFoundException,
	Param,
	Patch,
	Post,
	UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	AppendInvestigationEventsSchema,
	CanonicalEventSchema,
} from "@prismalens/contracts";
import { Public } from "../../core/auth/public.decorator.js";
import { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import {
	InternalInvestigationResultDto,
	UpdateInvestigationStatusDto,
} from "./dto/index.js";
import { InternalGuard } from "./guards/internal.guard.js";

/**
 * Internal API for investigation operations.
 * Used by the Python worker to update investigation status and write results.
 * Protected by InternalGuard (requires X-Internal-Secret header).
 * @Public() skips AuthGuard — InternalGuard handles auth via X-Internal-Secret.
 */
@Public()
@ApiExcludeController()
@Controller("internal/investigations")
@UseGuards(InternalGuard)
export class InternalInvestigationsController {
	private readonly logger = new Logger(InternalInvestigationsController.name);

	constructor(private readonly investigationsService: InvestigationsService) {}

	/**
	 * Bulk-append canonical events to the durable record (ADR-0018 `store.append`).
	 * Called by the worker store's batched flush. Each event is validated with
	 * {@link CanonicalEventSchema}; an invalid one is dropped + logged (NEVER a 500 —
	 * one bad event must not fail the batch). The insert is idempotent, so a batch
	 * retry is a no-op. Returns the accepted/dropped counts.
	 */
	@Post(":id/events")
	@HttpCode(HttpStatus.OK)
	async appendEvents(
		@Param("id") id: string,
		@Body() body: unknown,
	): Promise<{ accepted: number; dropped: number }> {
		const envelope = AppendInvestigationEventsSchema.safeParse(body);
		if (!envelope.success) {
			// A malformed envelope (not `{ events: [...] }`) is a client error — distinct
			// from a per-event validation drop.
			throw new BadRequestException(
				"Expected body shape { events: unknown[] }",
			);
		}

		const valid: CanonicalEvent[] = [];
		let dropped = 0;
		for (const raw of envelope.data.events) {
			const parsed = CanonicalEventSchema.safeParse(raw);
			if (parsed.success) {
				valid.push(parsed.data);
			} else {
				dropped++;
				this.logger.warn(
					`Dropped invalid canonical event for investigation ${id}: ${parsed.error.message}`,
				);
			}
		}

		if (valid.length > 0) {
			await this.investigationsService.appendEvents(id, valid);
		}

		return { accepted: valid.length, dropped };
	}

	/**
	 * Clear the durable canonical event record (ADR-0018 B.4). Called by the worker at
	 * the START of a BullMQ RETRY so each attempt owns a FRESH record — attempt 2's
	 * events would otherwise collide with attempt 1's on `(investigationId, branchId,
	 * seq)` and be swallowed as duplicates (P2002), leaving the record showing the failed
	 * attempt's events for a run that later completes. Idempotent (deleting zero rows is
	 * a no-op). Same X-Internal-Secret guard as the bulk-append above.
	 */
	@Post(":id/events/clear")
	@HttpCode(HttpStatus.OK)
	async clearEvents(@Param("id") id: string): Promise<{ deleted: number }> {
		const deleted = await this.investigationsService.clearEvents(id);
		return { deleted };
	}

	/**
	 * Update investigation status (real-time updates during execution)
	 * Called when job starts (running), fails, or is cancelled
	 */
	@Patch(":id/status")
	@HttpCode(HttpStatus.OK)
	async updateStatus(
		@Param("id") id: string,
		@Body() dto: UpdateInvestigationStatusDto,
	) {
		const investigation = await this.investigationsService.updateStatusInternal(
			id,
			dto.status,
			dto.startedAt ? new Date(dto.startedAt) : undefined,
			dto.error,
			dto.harnessThreadId,
		);

		if (!investigation) {
			throw new NotFoundException(`Investigation ${id} not found`);
		}

		return investigation;
	}

	/**
	 * Write full investigation result (atomic write of all data)
	 * Called when worker completes analysis - writes investigation, agents, tools, recommendations
	 */
	@Post(":id/result")
	@HttpCode(HttpStatus.OK)
	async writeResult(
		@Param("id") id: string,
		@Body() dto: InternalInvestigationResultDto,
	) {
		const investigation =
			await this.investigationsService.writeResultWithRelations(id, dto);

		if (!investigation) {
			throw new NotFoundException(`Investigation ${id} not found`);
		}

		return investigation;
	}
}
