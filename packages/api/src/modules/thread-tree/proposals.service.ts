// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { HARNESS_IDS } from "@prismalens/config/harness";
import {
	type Proposal,
	type ProposalChange,
	ProposalChangeSchema,
	type ThreadTreeSettings,
} from "@prismalens/contracts";
import type { Proposal as ProposalRow } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { RepositoriesService } from "../repositories/repositories.service.js";
import { SchedulesService } from "../schedules/schedules.service.js";
import { TreeIo } from "./tree-io.js";
import { TreeSettings } from "./tree-settings.js";

/** Open cards one thread may hold; more would be noise the user has to clear. */
const OPEN_PER_THREAD = 10;

export function proposalView(row: ProposalRow): Proposal {
	return {
		id: row.id,
		threadId: row.threadId,
		kind: row.kind as Proposal["kind"],
		change: ProposalChangeSchema.parse(JSON.parse(row.change)),
		why: row.why,
		state: row.state as Proposal["state"],
		createdAt: row.createdAt.toISOString(),
		outcome: row.outcome,
	};
}

/**
 * `propose_action` (#1024 spec F, rank 7): the agent records a card, and only the host's
 * click applies it, through the same service the normal endpoint for that kind calls.
 */
@Injectable()
export class ProposalsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly io: TreeIo,
		private readonly settings: TreeSettings,
		private readonly repositories: RepositoriesService,
		private readonly schedules: SchedulesService,
	) {}

	async propose(
		threadId: string,
		change: ProposalChange,
		why: string,
	): Promise<Proposal | { error: string }> {
		const open = await this.prisma.proposal.count({
			where: { threadId, state: "open" },
		});
		if (open >= OPEN_PER_THREAD)
			return { error: `This thread already has ${open} open proposals.` };
		const row = await this.prisma.proposal.create({
			data: {
				threadId,
				kind: change.kind,
				change: JSON.stringify(change),
				why,
			},
		});
		const proposal = proposalView(row);
		await this.io.record(threadId, { kind: "action_proposed", proposal });
		return proposal;
	}

	private async open(threadId: string, id: string): Promise<ProposalRow> {
		const row = await this.prisma.proposal.findUnique({ where: { id } });
		if (!row || row.threadId !== threadId)
			throw new ORPCError("NOT_FOUND", { message: "No such proposal." });
		if (row.state !== "open")
			throw new ORPCError("CONFLICT", {
				message: `This proposal was already ${row.state}.`,
			});
		return row;
	}

	/** Host only: the caller checks the session before calling. */
	async apply(
		threadId: string,
		id: string,
		deviceId: string | null,
	): Promise<Proposal> {
		const row = await this.open(threadId, id);
		const change = ProposalChangeSchema.parse(JSON.parse(row.change));
		const outcome = await this.run(threadId, change, deviceId);
		return this.decide(row, "applied", outcome);
	}

	async dismiss(threadId: string, id: string): Promise<Proposal> {
		return this.decide(await this.open(threadId, id), "dismissed", null);
	}

	private async decide(
		row: ProposalRow,
		state: "applied" | "dismissed",
		outcome: string | null,
	): Promise<Proposal> {
		const { count } = await this.prisma.proposal.updateMany({
			where: { id: row.id, state: "open" },
			data: { state, outcome, decidedAt: new Date() },
		});
		if (!count)
			throw new ORPCError("CONFLICT", {
				message: "This proposal was already decided.",
			});
		await this.io.record(row.threadId, {
			kind: "action_resolved",
			proposalId: row.id,
			state,
		});
		return proposalView(
			await this.prisma.proposal.findUniqueOrThrow({ where: { id: row.id } }),
		);
	}

	/** One change, through the service its normal endpoint uses; a refusal is the user's to read. */
	private async run(
		threadId: string,
		change: ProposalChange,
		deviceId: string | null,
	): Promise<string> {
		switch (change.kind) {
			case "setting": {
				const current = await this.settings.get();
				const next = {
					...current,
					[change.key]: change.value,
				} as ThreadTreeSettings;
				await this.settings.set(next);
				return `${change.key} is now ${change.value}.`;
			}
			case "service_link": {
				await this.repositories.linkToService(change.repositoryId, {
					serviceId: change.serviceId,
				});
				return "Linked.";
			}
			case "project_add": {
				const repo = await this.repositories.addSource({
					source: change.source,
				});
				return `Added project ${repo.id}.`;
			}
			case "schedule": {
				const thread = await this.prisma.investigation.findUniqueOrThrow({
					where: { id: threadId },
					select: {
						harness: true,
						model: true,
						effort: true,
						repositoryId: true,
						serviceId: true,
						incident: { select: { serviceId: true } },
					},
				});
				const harness = HARNESS_IDS.find((h) => h === thread.harness);
				if (!harness)
					throw new ORPCError("BAD_REQUEST", {
						message: "This thread has no agent to run the schedule with.",
					});
				const serviceId = thread.repositoryId
					? null
					: (thread.incident?.serviceId ?? thread.serviceId);
				const created = await this.schedules.create(
					{
						name: change.name,
						serviceId,
						repositoryId: thread.repositoryId,
						runbook: null,
						brief: change.brief,
						recurrence: {
							type: "cron",
							expr: change.cron,
							timezone: change.timezone,
						},
						harness,
						model: thread.model,
						effort: thread.effort,
						accessLevel: null,
						report: false,
						whenAsks: "decide",
						missedPolicy: "run_once",
						catchUpMinutes: 60,
					},
					deviceId,
				);
				return `Scheduled ${created.id}.`;
			}
		}
	}
}
