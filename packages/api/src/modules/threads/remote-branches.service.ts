// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Injectable,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
import { PR_WATCH_EVERY_MS, RunWorkspaceSchema } from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import {
	lsRemoteHead,
	remoteHeadOf,
	setRemoteHead,
} from "../investigations/remote-heads.js";

/** Live threads active this recently have their pushed branches looked up. */
const ACTIVE_DAYS = 7;
const MAX_THREADS = 50;
const AT_ONCE = 4;

/**
 * A pushed branch with no PR watch (#1101 bar 15.1): one `git ls-remote` per poll, on the
 * watch's cadence, so a branch deleted or moved on the remote shows without a fetch.
 */
@Injectable()
export class RemoteBranchesService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger({ context: "RemoteBranches" });
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking = false;

	constructor(private readonly prisma: PrismaService) {}

	onModuleInit(): void {
		this.timer = setInterval(() => {
			void this.tick().catch((e) =>
				this.logger.warn(`A remote branch pass failed: ${String(e)}`),
			);
		}, PR_WATCH_EVERY_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	async tick(now = new Date()): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			const rows = await this.prisma.investigation.findMany({
				where: {
					settledAt: null,
					archivedAt: null,
					teardownAt: null,
					workspace: { not: null },
					updatedAt: {
						gte: new Date(now.getTime() - ACTIVE_DAYS * 86_400_000),
					},
					// The PR poll reads the host for these.
					prFeeds: { none: { state: { in: ["watching", "disconnected"] } } },
				},
				orderBy: { updatedAt: "desc" },
				take: MAX_THREADS,
				select: { workspace: true },
			});
			const dirs = rows.flatMap((r) => {
				const ws = RunWorkspaceSchema.safeParse(
					safeParseJsonObject(r.workspace),
				).data;
				return ws && ws.layout !== "folder" && ws.layout !== "unmapped"
					? ws.repos.map((x) => x.dir)
					: [];
			});
			for (let i = 0; i < dirs.length; i += AT_ONCE)
				await Promise.all(
					dirs.slice(i, i + AT_ONCE).map(async (dir) => {
						// A fresh reading from the host wins over ls-remote.
						const kept = remoteHeadOf(dir);
						if (kept?.source === "host") return;
						const head = await lsRemoteHead(dir).catch(() => null);
						if (head) setRemoteHead(dir, head);
					}),
				);
		} finally {
			this.ticking = false;
		}
	}
}
