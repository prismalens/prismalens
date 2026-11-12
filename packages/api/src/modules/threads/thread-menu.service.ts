// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	AccessLevelSchema,
	isWorkflowLive,
	type Quote,
	RunChoiceSchema,
} from "@prismalens/contracts";
import { liveChanges } from "../../core/live/live-changes.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { SIDE_QUESTION } from "./side-question.js";
import { ThreadsService } from "./threads.service.js";

const FORK_ROLE = { fork: "fork", side: SIDE_QUESTION } as const;

/** The thread menu's own actions (#1101 category 20): Pin, Archive, Fork here, Side question. */
@Injectable()
export class ThreadMenuService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly threads: ThreadsService,
	) {}

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
		const at = on ? new Date() : null;
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

	/** Keep as thread: a side question becomes a fork, listed in the tree and the list. */
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
	 * A child thread under this one that reads it as a reference: Fork here carries the
	 * work on, Side question asks beside it. The parent's own run is never touched.
	 */
	async fork(
		id: string,
		mode: "fork" | "side",
		text: string,
		quotes?: Quote[],
	) {
		const parent = await this.prisma.investigation.findUnique({
			where: { id },
		});
		if (!parent)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		if (parent.incidentId || parent.scheduleId)
			throw new ORPCError("BAD_REQUEST", {
				message: "Fork from the incident's own thread page.",
			});
		const rootId = parent.rootId ?? parent.id;
		if (!parent.rootId)
			await this.prisma.investigation.update({
				where: { id },
				data: { rootId: id, updatedAt: parent.updatedAt },
			});
		const title = parent.title?.trim() || "Thread";
		const access = AccessLevelSchema.safeParse(parent.accessLevel).data;
		const harness = RunChoiceSchema.shape.harness.safeParse(
			parent.harness,
		).data;
		return this.threads.start(
			{
				subject: parent.repositoryId
					? { kind: "project", repositoryId: parent.repositoryId }
					: parent.serviceId
						? { kind: "service", serviceId: parent.serviceId }
						: { kind: "none" },
				text,
				references: [{ kind: "thread", id, label: title.slice(0, 200) }],
				...(quotes?.length ? { quotes } : {}),
				...(access ? { accessLevel: access } : {}),
				...(harness ? { harness } : {}),
				...(parent.model ? { model: parent.model } : {}),
				...(parent.effort ? { effort: parent.effort } : {}),
			},
			{
				parentId: id,
				rootId,
				role: FORK_ROLE[mode],
				depth: parent.depth + 1,
				title: text.split("\n")[0]?.slice(0, 80) ?? title,
				actionId: randomUUID(),
			},
		);
	}
}
