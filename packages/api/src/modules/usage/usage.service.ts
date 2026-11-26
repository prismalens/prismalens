// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Inject, Injectable, Optional } from "@nestjs/common";
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import {
	type AgentLimits,
	type Enforcement,
	type EnforcementRow,
	LIMIT_WINDOWS,
	type LimitWindow,
	type ModelPrice,
	type ModelPrices,
	RunFidelitySchema,
	type UsageBucket,
	type UsageLimits,
	type UsageModel,
	type UsageQuery,
	type UsageSummary,
	type UsageWindow,
} from "@prismalens/contracts";
import * as clock from "../../core/clock.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	LIMIT_SOURCE,
	type LimitReadEntry,
	type LimitSource,
	readLimitReads,
	readsBeforeRun,
	recordLimitRead,
} from "./limit-reads.js";
import { estimateCost, matchPrice, readPrices, writePrices } from "./prices.js";
import {
	advanceContext,
	type TurnContext,
	turnIdentity,
} from "./turn-identity.js";
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
	/** One read per agent at a time; a second ask while one runs gets its answer. */
	private readonly reading = new Map<HarnessId, Promise<AgentLimits>>();
	/** AGENT_LIMIT_READS writes, one at a time. */
	private writes: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly prisma: PrismaService,
		@Optional() private readonly harness?: HarnessService,
		@Optional()
		@Inject(LIMIT_SOURCE)
		private readonly limitSource?: LimitSource,
	) {}

	async summary(
		query: UsageQuery,
		now: Date = clock.date(),
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
			select: {
				investigationId: true,
				event: true,
				createdAt: true,
				ordinal: true,
			},
			orderBy: { createdAt: "asc" },
		});
		const contexts = await this.turnContexts(events);
		const prices = (await readPrices(this.prisma)).prices;

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
			const estimate = this.estimate(
				prices,
				usage,
				contexts.get(e) ?? { harness: null, model: null },
				agent,
			);
			addTurn(totals, usage, estimate);
			const day = days.get(key);
			if (day) addTurn(day, usage, estimate);
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
			addTurn(row.bucket, usage, estimate);
			const md = row.days.get(key);
			if (md) addTurn(md, usage, estimate);
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

	/**
	 * Each installed agent and each that ran: its windows from the last limit read and the
	 * runs' `agent_quota`, merged per window within one account (#1171, #1180), or why none.
	 */
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
		const byAgent = new Map<string, Map<string, RunWindow>>();
		for (const e of events) {
			const agent = e.investigation.harness;
			if (!agent) continue;
			const w = readQuota(e.event, e.createdAt);
			if (!w) continue;
			const windows = byAgent.get(agent) ?? new Map<string, RunWindow>();
			byAgent.set(agent, windows);
			if (!windows.has(w.key)) windows.set(w.key, w);
		}
		const reads = await readLimitReads(this.prisma);
		const ran = await this.agentsThatRan();
		const agents = new Set([
			...((await this.harness?.installedIds()) ?? []),
			...ran,
			...byAgent.keys(),
			...Object.keys(reads),
		]);
		return {
			agents: [...agents]
				.sort()
				.map((agent) =>
					this.agentLimits(agent, byAgent.get(agent), reads[agent], ran),
				),
		};
	}

	/**
	 * One agent's row. A read shows while its runtime is current and its account is the newest
	 * PrismaLens has; a run window joins only from that account, or, with none, while no read
	 * with an account is newer. Newest per window key; each keeps its own time and source.
	 */
	private agentLimits(
		agent: string,
		runs: Map<string, RunWindow> | undefined,
		entry: LimitReadEntry | undefined,
		ran: readonly string[],
	): AgentLimits {
		const id = agent as HarnessId;
		const ok = entry?.ok ?? null;
		const check = this.limitSource?.checkedAccount(id) ?? null;
		const newest =
			check?.account && (!ok || check.at > ok.at)
				? check.account
				: (entry?.account ?? check?.account ?? null);
		const shown =
			ok &&
			entry &&
			entry.runtime === (this.limitSource?.currentKey(id) ?? "") &&
			(newest === null || entry.account === newest)
				? ok
				: null;
		const merged = new Map<string, UsageWindow>();
		for (const w of shown?.windows ?? [])
			merged.set(w.key, {
				window: w.window,
				type: w.type,
				usedPercent: w.usedPercent,
				resetsAt: w.resetsAt,
				status: w.status,
				at: shown?.at ?? "",
				key: w.key,
				via: "check",
			});
		for (const run of runs?.values() ?? []) {
			const eligible = run.account
				? newest === null || run.account === newest
				: !(ok?.account && ok.at > run.at);
			const kept = merged.get(run.key);
			if (!eligible || (kept && kept.at >= run.at)) continue;
			const { account: _account, ...w } = run;
			merged.set(run.key, w);
		}
		const windows = [...merged.values()].sort(
			(a, b) => windowRank(a.window) - windowRank(b.window),
		);
		const tried = entry?.tried;
		const triedAt =
			tried?.outcome === "failed" && (!shown || tried.at > shown.at)
				? tried.at
				: null;
		const before = readsBeforeRun(agent);
		const reports = HARNESS_REGISTRY[id]?.reportsLimits === true;
		return {
			agent,
			windows,
			empty: windows.length
				? null
				: before || (reports && !ran.includes(agent))
					? "no-run-yet"
					: "not-reported",
			checkedAt: shown?.at ?? null,
			triedAt,
		};
	}

	/** Reads `agent`'s plan limits now through its own CLI and records the try (#1180). */
	async readLimits(agent: string): Promise<AgentLimits> {
		const id = agent as HarnessId;
		const running = this.reading.get(id);
		if (running) return running;
		const work = this.readOnce(id).finally(() => this.reading.delete(id));
		this.reading.set(id, work);
		return work;
	}

	private async readOnce(id: HarnessId): Promise<AgentLimits> {
		const source = this.limitSource;
		if (source && readsBeforeRun(id)) {
			const inputs = await source.inputs(id).catch(() => null);
			const read = inputs
				? await source.read(id, inputs.runtime).catch(() => null)
				: null;
			const at = clock.date().toISOString();
			const write = this.writes.then(() =>
				recordLimitRead(this.prisma, id, inputs?.key ?? "", read, at),
			);
			this.writes = write.catch(() => {});
			await write;
		}
		const all = await this.limits();
		return (
			all.agents.find((a) => a.agent === id) ??
			this.agentLimits(id, undefined, undefined, [])
		);
	}

	prices(): Promise<ModelPrices> {
		return readPrices(this.prisma);
	}

	setPrices(next: ModelPrices): Promise<ModelPrices> {
		return writePrices(this.prisma, next);
	}

	/** Each turn's context from its thread's earlier session openings and model switches. */
	private async turnContexts<
		E extends { investigationId: string; ordinal: number },
	>(turns: readonly E[]): Promise<Map<E, TurnContext>> {
		const ids = [...new Set(turns.map((t) => t.investigationId))];
		const out = new Map<E, TurnContext>();
		if (!ids.length) return out;
		const marks = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: { in: ids },
				OR: [
					{ event: { contains: '"kind":"session_opened"' } },
					{ event: { contains: '"kind":"session_config"' } },
				],
			},
			select: { investigationId: true, event: true, ordinal: true },
			orderBy: { ordinal: "asc" },
		});
		const byThread = new Map<string, typeof marks>();
		for (const m of marks) {
			const list = byThread.get(m.investigationId) ?? [];
			list.push(m);
			byThread.set(m.investigationId, list);
		}
		const sorted = [...turns].sort((a, b) => a.ordinal - b.ordinal);
		const cursor = new Map<string, { i: number; ctx: TurnContext }>();
		for (const t of sorted) {
			const list = byThread.get(t.investigationId) ?? [];
			const at = cursor.get(t.investigationId) ?? {
				i: 0,
				ctx: { harness: null, model: null },
			};
			for (let m = list[at.i]; m && m.ordinal < t.ordinal; m = list[at.i]) {
				at.ctx = advanceContext(at.ctx, m.event);
				at.i += 1;
			}
			cursor.set(t.investigationId, at);
			out.set(t, at.ctx);
		}
		return out;
	}

	/** The person's price over a turn with no reported cost, by the one match rule; else null. */
	private estimate(
		prices: readonly ModelPrice[],
		usage: NonNullable<ReturnType<typeof readTurnUsage>>,
		ctx: TurnContext,
		threadHarness: string | null,
	): number | null {
		if (usage.cost || !prices.length) return null;
		const price = matchPrice(prices, turnIdentity(usage, ctx, threadHarness));
		return price ? estimateCost(usage, price) : null;
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

/** A run's window with the account the run was signed in to, when it recorded one. */
type RunWindow = UsageWindow & { key: string; account: string | null };

/** One `agent_quota` event as a window; a percentage outside 0-100 is clamped. */
export function readQuota(event: string, at: Date): RunWindow | null {
	try {
		const q = JSON.parse(event) as Record<string, unknown>;
		if (q.kind !== "agent_quota") return null;
		const window = LIMIT_WINDOWS.includes(q.window as LimitWindow)
			? (q.window as LimitWindow)
			: null;
		const used = typeof q.usedPercent === "number" ? q.usedPercent : null;
		const resets =
			typeof q.resetsAt === "string" ? Date.parse(q.resetsAt) : Number.NaN;
		const type = typeof q.type === "string" ? q.type : null;
		return {
			window,
			type,
			usedPercent: used === null ? null : Math.min(100, Math.max(0, used)),
			resetsAt: Number.isNaN(resets) ? null : new Date(resets).toISOString(),
			status: typeof q.status === "string" ? q.status : null,
			at: at.toISOString(),
			key: `${type ?? ""}:${window ?? ""}`,
			via: "run",
			account: typeof q.account === "string" && q.account ? q.account : null,
		};
	} catch {
		return null;
	}
}

const windowRank = (w: LimitWindow | null) =>
	w ? LIMIT_WINDOWS.indexOf(w) : LIMIT_WINDOWS.length;
