// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type {
	Investigation as InvestigationView,
	RunChoice,
	StartThreadInput,
} from "@prismalens/contracts";
import { AccessLevelSchema } from "@prismalens/contracts";
import type { Investigation } from "@prismalens/database";
import { HarnessService } from "../../core/harness/harness.service.js";
import { requireReadyHarness } from "../../core/harness/ready-harness.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { threadSubject } from "../investigations/run-scope.js";

/** The chips a request named; each field it left out falls back to Settings. */
function runChoice({ harness, model, effort }: RunChoice): RunChoice {
	return {
		...(harness ? { harness } : {}),
		...(model !== undefined ? { model } : {}),
		...(effort !== undefined ? { effort } : {}),
	};
}

/** A thread list row; agent text such as the title is shown as plain text only. */
export function threadView(row: Investigation): InvestigationView {
	return {
		id: row.id,
		incidentId: row.incidentId,
		serviceId: row.serviceId,
		scheduleId: row.scheduleId,
		repositoryId: row.repositoryId,
		subject: threadSubject(row),
		status: row.status as InvestigationView["status"],
		kind: row.kind === "chat" ? "chat" : "investigation",
		title: row.title,
		accessLevel: AccessLevelSchema.safeParse(row.accessLevel).data ?? null,
		harness: row.harness,
		model: row.model,
		effort: row.effort,
		startedAt: row.startedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		error: row.error,
		awaitingApprovalAt: row.awaitingApprovalAt?.toISOString() ?? null,
		origin: row.origin,
		schemaVersion: row.schemaVersion,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * Project, service and no-subject threads (#1020). Each is its own admission unit, so
 * two never collide; the agent checks are the incident chat's.
 */
@Injectable()
export class ThreadsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly investigations: InvestigationsService,
		private readonly dispatch: DispatchService,
		private readonly harness: HarnessService,
		private readonly attachments: AttachmentsService,
		private readonly integrations: IntegrationsService,
	) {}

	async start(input: StartThreadInput): Promise<{
		investigationId: string;
		jobId: string | null;
		queued: boolean;
	}> {
		const subject = input.subject;
		const ids = {
			repositoryId: subject.kind === "project" ? subject.repositoryId : null,
			serviceId: subject.kind === "service" ? subject.serviceId : null,
		};
		if (ids.repositoryId) {
			const found = await this.prisma.repository.findUnique({
				where: { id: ids.repositoryId },
				select: { id: true },
			});
			if (!found)
				throw new ORPCError("NOT_FOUND", { message: "Project not found" });
		}
		if (ids.serviceId) {
			const found = await this.prisma.service.findUnique({
				where: { id: ids.serviceId },
				select: { id: true },
			});
			if (!found)
				throw new ORPCError("NOT_FOUND", { message: "Service not found" });
		}
		const files = input.attachments ?? [];
		if (files.length && !input.draftKey)
			throw new ORPCError("BAD_REQUEST", {
				message: "Attach files to a draft first.",
			});
		if (input.draftKey)
			await this.attachments.checkDraft(input.draftKey, files);
		const choice = runChoice(input);
		await requireReadyHarness(this.harness, choice);

		const { investigation } = await this.investigations.startOrGet({
			incidentId: null,
			...(ids.repositoryId ? { repositoryId: ids.repositoryId } : {}),
			...(ids.serviceId ? { serviceId: ids.serviceId } : {}),
			triggerType: "manual",
			kind: "chat",
			title: input.text.slice(0, 120),
			accessLevel: input.accessLevel ?? null,
		});
		const thread = await this.dispatch.threadRunOf(ids);
		const attachments = input.draftKey
			? await this.attachments.claimDraft(
					input.draftKey,
					files,
					investigation.id,
				)
			: [];
		const connections = ids.serviceId
			? await this.integrations.getIntegrationsForService(ids.serviceId)
			: [];
		const jobId = await this.dispatch.addInvestigationJob({
			incidentId: null,
			investigationId: investigation.id,
			thread,
			kind: "chat",
			...(connections.length
				? { connectionIds: connections.map((c) => c.connectionId) }
				: {}),
			...(input.accessLevel ? { accessLevel: input.accessLevel } : {}),
			...choice,
			chat: {
				text: input.text,
				...(attachments.length ? { attachments } : {}),
			},
		});
		return {
			investigationId: investigation.id,
			jobId,
			queued: jobId !== null,
		};
	}

	/** A project's or a service's own threads, newest first; never its incidents' or schedules'. */
	async list(query: {
		repositoryId?: string;
		serviceId?: string;
		limit: number;
	}): Promise<InvestigationView[]> {
		if (!query.repositoryId && !query.serviceId) return [];
		const rows = await this.prisma.investigation.findMany({
			where: {
				incidentId: null,
				scheduleId: null,
				...(query.repositoryId
					? { repositoryId: query.repositoryId }
					: { serviceId: query.serviceId, repositoryId: null }),
			},
			orderBy: { createdAt: "desc" },
			take: query.limit,
		});
		return rows.map(threadView);
	}
}
