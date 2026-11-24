// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import {
	AccessLevelSchema,
	type ForkPreview,
	type InvestigationReport,
	isWorkflowLive,
	type Quote,
	type RunChoice,
	RunChoiceSchema,
} from "@prismalens/contracts";
import { buildFreshSummary, type Handoff } from "@prismalens/engine";
import * as clock from "../../core/clock.js";
import { liveChanges } from "../../core/live/live-changes.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { SIDE_QUESTION } from "./side-question.js";
import { ThreadsService } from "./threads.service.js";

const FORK_ROLE = { fork: "fork", side: SIDE_QUESTION } as const;
/** About 8,000 tokens, under the message addendum's cap (#1176 D13). */
const FORK_SUMMARY_CHARS = 32_000;
const FORK_OMITTED = "earlier detail; it stays in the thread you came from";

/** The thread menu's own actions (#1101 category 20): Pin, Archive, Fork here, Side question. */
@Injectable()
export class ThreadMenuService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly threads: ThreadsService,
		private readonly investigations: InvestigationsService,
	) {}

	/** What a fork or side question of this thread carries, as its box says (#1176 D13). */
	async forkPreview(id: string): Promise<ForkPreview> {
		const parent = await this.prisma.investigation.findUnique({
			where: { id },
			select: { id: true, harness: true, report: true },
		});
		if (!parent)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		const { carried, omitted } = await this.summary(parent);
		return {
			carried: carried.slice(0, 300),
			omitted: omitted?.slice(0, 300) ?? null,
		};
	}

	/** The parent's conversation as a summary; it names no transcript file, so a tool-free side question can use it. */
	private async summary(parent: {
		id: string;
		harness: string | null;
		report: string | null;
	}): Promise<Handoff> {
		const from =
			parent.harness && parent.harness in HARNESS_REGISTRY
				? HARNESS_REGISTRY[parent.harness as keyof typeof HARNESS_REGISTRY]
						.label
				: null;
		return buildFreshSummary({
			events: await this.investigations.allEvents(parent.id),
			report:
				(safeParseJsonObject(parent.report) as
					| InvestigationReport
					| undefined) ?? null,
			from,
			budgetChars: FORK_SUMMARY_CHARS,
			opening: `You are starting from a conversation ${from ?? "an agent"} had in another thread. A summary of it follows; that thread is unchanged.`,
			omitted: FORK_OMITTED,
		});
	}

	async pin(id: string, on: boolean) {
		return this.flag(id, "pinnedAt", on);
	}

	/** Archive hides a thread from the list; a running one is stopped or settled first. */
	async archive(id: string, on: boolean) {
		if (on) {
			const row = await this.prisma.investigation.findUnique({
				where: { id },
				select: { status: true },
			});
			if (row && isWorkflowLive(row.status))
				throw new ORPCError("CONFLICT", {
					message: "Stop the thread before you archive it.",
				});
		}
		return this.flag(id, "archivedAt", on);
	}

	private async flag(
		id: string,
		field: "pinnedAt" | "archivedAt",
		on: boolean,
	) {
		const at = on ? clock.date() : null;
		// The row's own updatedAt orders the list; a flag never moves it (#1020).
		const row = await this.prisma.investigation.findUnique({
			where: { id },
			select: { updatedAt: true },
		});
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		await this.prisma.investigation.update({
			where: { id },
			data: { [field]: at, updatedAt: row.updatedAt },
		});
		liveChanges.noteTopic("threads");
		return { id, at: at?.toISOString() ?? null };
	}

	/** Keep as thread: a side question becomes a fork, listed as a sibling marked forked-from. */
	async keep(id: string) {
		const kept = await this.prisma.investigation.updateMany({
			where: { id, role: SIDE_QUESTION },
			data: { role: FORK_ROLE.fork },
		});
		if (!kept.count)
			throw new ORPCError("NOT_FOUND", {
				message: "No side question with that id",
			});
		liveChanges.noteTopic("threads");
		return { id };
	}

	/**
	 * A sibling thread marked forked-from this one, reading it as a reference: Fork here
	 * carries the work on, Side question asks beside it. This thread's run is never touched.
	 */
	async fork(
		id: string,
		mode: "fork" | "side",
		text: string,
		quotes?: Quote[],
		choice: RunChoice = {},
	) {
		const parent = await this.prisma.investigation.findUnique({
			where: { id },
		});
		if (!parent)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		// A schedule's thread is a thread: it forks like any other (#1101, every thread takes a reply).
		if (parent.incidentId)
			throw new ORPCError("BAD_REQUEST", {
				message: "Fork from the incident's own thread page.",
			});
		const title = parent.title?.trim() || "Thread";
		const access = AccessLevelSchema.safeParse(parent.accessLevel).data;
		const own = RunChoiceSchema.shape.harness.safeParse(parent.harness).data;
		const harness = choice.harness ?? own;
		// Another agent takes none of the parent's model or effort.
		const same = harness === own;
		const model =
			choice.model !== undefined ? choice.model : same ? parent.model : null;
		const effort =
			choice.effort !== undefined ? choice.effort : same ? parent.effort : null;
		const { text: carry } = await this.summary(parent);
		return this.threads.start(
			{
				subject: parent.repositoryId
					? { kind: "project", repositoryId: parent.repositoryId }
					: parent.serviceId
						? { kind: "service", serviceId: parent.serviceId }
						: { kind: "none" },
				text,
				...(quotes?.length ? { quotes } : {}),
				...(access ? { accessLevel: access } : {}),
				...(harness ? { harness } : {}),
				...(model ? { model } : {}),
				...(effort ? { effort } : {}),
			},
			{
				parentId: id,
				rootId: null,
				role: FORK_ROLE[mode],
				depth: 0,
				title: text.split("\n")[0]?.slice(0, 80) ?? title,
				actionId: randomUUID(),
				carry,
			},
		);
	}
}
