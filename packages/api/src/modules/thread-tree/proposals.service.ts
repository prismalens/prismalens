// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { HARNESS_IDS } from "@prismalens/config/harness";
import {
	type Proposal,
	type ProposalChange,
	ProposalChangeSchema,
	type ThreadTreeSettings,
	ThreadTreeSettingsSchema,
} from "@prismalens/contracts";
import type { Proposal as ProposalRow } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { RepositoriesService } from "../repositories/repositories.service.js";
import {
	ScheduleError,
	SchedulesService,
} from "../schedules/schedules.service.js";
import { TreeIo } from "./tree-io.service.js";
import { TreeSettings } from "./tree-settings.service.js";

/** What a card left `applying` by a stop says: its change may or may not have happened. */
const UNCONFIRMED =
	"PrismaLens stopped before this change was confirmed. Check whether it happened before proposing it again.";

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
 * `pl_propose_action` (#1024 spec F, rank 7): the agent records a card, and only the host's
 * click applies it, through the same service the normal endpoint for that kind calls.
 */
@Injectable()
export class ProposalsService implements OnApplicationBootstrap {
	/** Cards whose change is running in this process now; any other `applying` card was cut off. */
	private readonly applyingNow = new Set<string>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly io: TreeIo,
		private readonly settings: TreeSettings,
		private readonly repositories: RepositoriesService,
		private readonly schedules: SchedulesService,
	) {}

	/** At boot no change is running, so a card still `applying` was cut off: it is settled as unconfirmed. */
	async onApplicationBootstrap(): Promise<void> {
		const stuck = await this.prisma.proposal.findMany({
			where: { state: "applying" },
		});
		for (const row of stuck)
			await this.decide(row, "dismissed", UNCONFIRMED, "applying").catch(
				() => {},
			);
	}

	async propose(
		threadId: string,
		change: ProposalChange,
		why: string,
	): Promise<Proposal | { error: string; invalid?: true }> {
		if (change.kind === "setting") {
			const next = {
				...(await this.settings.get()),
				[change.key]: change.value,
			};
			const checked = ThreadTreeSettingsSchema.safeParse(next);
			if (!checked.success)
				return {
					error: `${change.key} cannot be ${JSON.stringify(change.value)}: ${checked.error.issues[0]?.message ?? "out of range"}.`,
					invalid: true,
				};
		}
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

	private async open(
		threadId: string,
		id: string,
		states: readonly string[] = ["open"],
	): Promise<ProposalRow> {
		const row = await this.prisma.proposal.findUnique({ where: { id } });
		if (!row || row.threadId !== threadId)
			throw new ORPCError("NOT_FOUND", { message: "No such proposal." });
		if (!states.includes(row.state))
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
		const { count } = await this.prisma.proposal.updateMany({
			where: { id: row.id, state: "open" },
			data: { state: "applying" },
		});
		if (!count)
			throw new ORPCError("CONFLICT", {
				message: "This proposal is already being applied or was decided.",
			});
		const change = ProposalChangeSchema.parse(JSON.parse(row.change));
		let outcome: string;
		this.applyingNow.add(row.id);
		try {
			outcome = await this.run(threadId, change, deviceId);
		} catch (e) {
			// The change did not happen, so the card is the user's to try again.
			await this.prisma.proposal.updateMany({
				where: { id: row.id, state: "applying" },
				data: { state: "open" },
			});
			this.applyingNow.delete(row.id);
			throw e;
		}
		try {
			return await this.decide(row, "applied", outcome, "applying");
		} finally {
			this.applyingNow.delete(row.id);
		}
	}

	/** Also clears a card a stop left `applying`; one whose change is running now waits for it. */
	async dismiss(threadId: string, id: string): Promise<Proposal> {
		const row = await this.open(threadId, id, ["open", "applying"]);
		if (row.state === "open") return this.decide(row, "dismissed", null);
		if (this.applyingNow.has(row.id))
			throw new ORPCError("CONFLICT", {
				message: "This proposal is being applied now.",
			});
		return this.decide(row, "dismissed", UNCONFIRMED, "applying");
	}

	private async decide(
		row: ProposalRow,
		state: "applied" | "dismissed",
		outcome: string | null,
		from: "open" | "applying" = "open",
	): Promise<Proposal> {
		const { count } = await this.prisma.proposal.updateMany({
			where: { id: row.id, state: from },
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
				const created = await this.schedules
					.create(
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
					)
					.catch((e: unknown) => {
						// The schedules endpoint answers its own refusals the same way.
						if (e instanceof ScheduleError)
							throw new ORPCError(e.code, { message: e.message });
						throw e;
					});
				return `Scheduled ${created.id}.`;
			}
		}
	}
}
