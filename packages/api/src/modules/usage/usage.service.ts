// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import {
	type Enforcement,
	type EnforcementRow,
	LIMIT_WINDOWS,
	type LimitWindow,
	RunFidelitySchema,
	type UsageBucket,
	type UsageLimits,
	type UsageModel,
	type UsageQuery,
	type UsageSummary,
	type UsageWindow,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	addTurn,
	bucketKey,
	bucketKeys,
	dayOf,
	emptyBucket,
	RANGE_SPAN,
	readTurnUsage,
} from "./usage.js";

const QUOTA_EVENTS = 1_000;
const ENFORCEMENT_RUNS = 300;
const SEP = "\u0000";

/** The Usage view's numbers, from the turns agents reported into PrismaLens's own record (#1101 cat 17). */
@Injectable()
export class UsageService {
	constructor(private readonly prisma: PrismaService) {}

	async summary(
		query: UsageQuery,
		now: Date = new Date(),
	): Promise<UsageSummary> {
		const span = RANGE_SPAN[query.range];
		const since = new Date(now.getTime() - span.ms);
		const scoped = !!(query.project || query.agent);
		const threads = await this.prisma.investigation.findMany({
			where: {
				...(query.project ? { repositoryId: query.project } : {}),
				...(query.agent ? { harness: query.agent } : {}),
			},
			select: { id: true, harness: true, model: true, updatedAt: true },
		});
		const byId = new Map(threads.map((t) => [t.id, t]));
		const events = await this.prisma.investigationEvent.findMany({
			where: {
				createdAt: { gte: since },
				event: { contains: '"kind":"turn_usage"' },
				...(scoped ? { investigationId: { in: [...byId.keys()] } } : {}),
			},
			select: { investigationId: true, event: true, createdAt: true },
			orderBy: { createdAt: "asc" },
		});

		const keys = bucketKeys(since, now, span.step);
		const totals = emptyBucket();
		const days = new Map(keys.map((k) => [k, emptyBucket()]));
		const models = new Map<
			string,
			{
				bucket: UsageBucket;
				agent: string | null;
				days: Map<string, UsageBucket>;
			}
		>();
		const seenThreads = new Set<string>();
		const reporting = new Set<string>();
		for (const e of events) {
			const usage = readTurnUsage(e.event);
			if (!usage) continue;
			const thread = byId.get(e.investigationId);
			const agent = thread?.harness ?? null;
			const model = usage.model ?? thread?.model ?? "unknown";
			const key = bucketKey(e.createdAt, span.step);
			seenThreads.add(e.investigationId);
			if (agent) reporting.add(agent);
			addTurn(totals, usage);
			const day = days.get(key);
			if (day) addTurn(day, usage);
			const id = `${agent ?? ""}${SEP}${model}`;
			let row = models.get(id);
			if (!row) {
				row = {
					bucket: emptyBucket(),
					agent,
					days: new Map(keys.map((k) => [k, emptyBucket()])),
				};
				models.set(id, row);
			}
			addTurn(row.bucket, usage);
			const md = row.days.get(key);
			if (md) addTurn(md, usage);
		}

		const ran = new Set(
			threads
				.filter((t) => t.harness && t.updatedAt >= since)
				.map((t) => t.harness as string),
		);
		const modelRows: UsageModel[] = [...models.entries()]
			.map(([id, row]) => ({
				...row.bucket,
				model: id.split(SEP)[1] as string,
				agent: row.agent,
				days: [...row.days.entries()].map(([k, b]) => dayOf(b, k)),
			}))
			.sort((a, b) => b.tokens.total - a.tokens.total);
		const projects = await this.prisma.repository.findMany({
			where: { threads: { some: {} } },
			select: { id: true, fullName: true },
			orderBy: { fullName: "asc" },
		});
		return {
			range: query.range,
			since: since.toISOString(),
			until: now.toISOString(),
			step: span.step,
			totals,
			threads: seenThreads.size,
			days: [...days.entries()].map(([k, b]) => dayOf(b, k)),
			models: modelRows,
			projects: projects.map((p) => ({ id: p.id, name: p.fullName })),
			agents: await this.agentsThatRan(),
			silentAgents: [...ran].filter((a) => !reporting.has(a)).sort(),
		};
	}

	/** Each agent's windows: the latest `agent_quota` it sent for each window. */
	async limits(): Promise<UsageLimits> {
		const events = await this.prisma.investigationEvent.findMany({
			where: { event: { contains: '"kind":"agent_quota"' } },
			select: {
				event: true,
				createdAt: true,
				investigation: { select: { harness: true } },
			},
			orderBy: { createdAt: "desc" },
			take: QUOTA_EVENTS,
		});
		const byAgent = new Map<string, Map<string, UsageWindow>>();
		for (const e of events) {
			const agent = e.investigation.harness;
			if (!agent) continue;
			const w = readQuota(e.event, e.createdAt);
			if (!w) continue;
			const windows = byAgent.get(agent) ?? new Map<string, UsageWindow>();
			byAgent.set(agent, windows);
			const key = w.type ?? w.window ?? "window";
			if (!windows.has(key)) windows.set(key, w);
		}
		const agents = new Set([
			...(await this.agentsThatRan()),
			...byAgent.keys(),
		]);
		return {
			agents: [...agents].sort().map((agent) => ({
				agent,
				windows: [...(byAgent.get(agent)?.values() ?? [])].sort(
					(a, b) => windowRank(a.window) - windowRank(b.window),
				),
			})),
		};
	}

	/** What each agent's runs enforced at each level, from the newest runs' report fidelity. */
	async enforcement(): Promise<Enforcement> {
		const runs = await this.prisma.investigation.findMany({
			where: { report: { not: null }, harness: { not: null } },
			select: { harness: true, report: true, createdAt: true },
			orderBy: { createdAt: "desc" },
			take: ENFORCEMENT_RUNS,
		});
		const rows = new Map<string, EnforcementRow>();
		for (const run of runs) {
			const fidelity = readFidelity(run.report);
			const access = fidelity?.ranAccess ?? fidelity?.access;
			if (!fidelity || !access) continue;
			const agent = run.harness as string;
			const key = `${agent}${SEP}${access}`;
			const row = rows.get(key);
			if (row) row.runs += 1;
			else
				rows.set(key, {
					agent,
					access,
					fidelity: fidelity.fidelity,
					mechanism: fidelity.mechanism,
					runs: 1,
					lastAt: run.createdAt.toISOString(),
				});
		}
		return { rows: [...rows.values()] };
	}

	private async agentsThatRan(): Promise<string[]> {
		const rows = await this.prisma.investigation.findMany({
			where: { harness: { not: null } },
			distinct: ["harness"],
			select: { harness: true },
		});
		return rows.map((r) => r.harness as string).sort();
	}
}

function readFidelity(report: string | null) {
	try {
		const raw = JSON.parse(report ?? "null") as { fidelity?: unknown } | null;
		const parsed = RunFidelitySchema.safeParse(raw?.fidelity);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/** One `agent_quota` event as a window; a percentage outside 0-100 is clamped. */
export function readQuota(event: string, at: Date): UsageWindow | null {
	try {
		const q = JSON.parse(event) as Record<string, unknown>;
		if (q.kind !== "agent_quota") return null;
		const window = LIMIT_WINDOWS.includes(q.window as LimitWindow)
			? (q.window as LimitWindow)
			: null;
		const used = typeof q.usedPercent === "number" ? q.usedPercent : null;
		const resets =
			typeof q.resetsAt === "string" ? Date.parse(q.resetsAt) : Number.NaN;
		return {
			window,
			type: typeof q.type === "string" ? q.type : null,
			usedPercent: used === null ? null : Math.min(100, Math.max(0, used)),
			resetsAt: Number.isNaN(resets) ? null : new Date(resets).toISOString(),
			status: typeof q.status === "string" ? q.status : null,
			at: at.toISOString(),
		};
	} catch {
		return null;
	}
}

const windowRank = (w: LimitWindow | null) =>
	w ? LIMIT_WINDOWS.indexOf(w) : LIMIT_WINDOWS.length;
