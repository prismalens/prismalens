// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A run's options in rank order, bound to their Recommendation rows by the id the host stamped
 * into the report (#811). A report written before ids is read-only: Copy works, nothing else.
 * The timeline keeps a check's verdict and time, never its value (ADR 0006 §1).
 */
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	type FixCheck,
	type Fixes,
	type FixOption,
	FixVerdictSchema,
	type NextStep,
	NextStepSchema,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { ImpactService } from "../impact/impact.service.js";

const APPLIED = "fix_applied";
const CHECKED = "fix_check";

const VERDICT_WORDS = {
	not_yet: "Not yet",
	below_threshold: "Below the alert threshold",
	could_not_check: "Could not check",
	it_worked: "It worked",
} as const;

interface Run {
	id: string;
	incidentId: string;
	steps: NextStep[];
	flagged: boolean;
}

interface FixEvent {
	id: string;
	stepId: string;
	event: string;
	verdict: string | null;
	at: Date;
}

@Injectable()
export class FixesService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly impact: ImpactService,
	) {}

	async forInvestigation(investigationId: string): Promise<Fixes> {
		const run = await this.run(investigationId);
		const [rows, events] = await Promise.all([
			this.rows(run),
			this.events(run),
		]);
		return {
			investigationId: run.id,
			flagged: run.flagged,
			options: run.steps.map((step, index) =>
				optionOf(step, index, rows, events),
			),
		};
	}

	/** "I applied it": the row goes to completed, and the timeline says so. */
	async apply(stepId: string): Promise<FixOption> {
		const { run, index } = await this.bound(stepId);
		const row = await this.prisma.recommendation.findUnique({
			where: { id: stepId },
		});
		if (row?.status !== "completed") {
			const step = run.steps[index] as NextStep;
			await this.prisma.$transaction([
				this.prisma.recommendation.update({
					where: { id: stepId },
					data: { status: "completed", implementedAt: new Date() },
				}),
				this.prisma.timelineEntry.create({
					data: {
						incidentId: run.incidentId,
						type: "recommendation_completed",
						title: `You applied: ${step.title}`,
						source: "user",
						metadata: JSON.stringify({
							investigationId: run.id,
							stepId,
							event: APPLIED,
						}),
					},
				}),
			]);
		}
		return this.option(run, index);
	}

	/** Undo is open until the first check after "I applied it". */
	async undo(stepId: string): Promise<FixOption> {
		const { run, index } = await this.bound(stepId);
		const option = await this.option(run, index);
		if (!option.appliedAt) return option;
		if (!option.canUndo)
			throw new ORPCError("CONFLICT", {
				message: "A check has run since you applied it; undo is closed.",
			});
		const applied = (await this.events(run)).filter(
			(e) => e.stepId === stepId && e.event === APPLIED,
		);
		await this.prisma.$transaction([
			this.prisma.recommendation.update({
				where: { id: stepId },
				data: { status: "pending", implementedAt: null },
			}),
			this.prisma.timelineEntry.deleteMany({
				where: { id: { in: applied.map((e) => e.id) } },
			}),
		]);
		return this.option(run, index);
	}

	async check(stepId: string): Promise<FixCheck> {
		const { run, index } = await this.bound(stepId);
		const option = await this.option(run, index);
		if (!option.appliedAt)
			throw new ORPCError("CONFLICT", {
				message: "Mark the option applied before checking it.",
			});
		const outcome = await this.impact.check(run.incidentId);
		const checkedAt = new Date();
		await this.prisma.timelineEntry.create({
			data: {
				incidentId: run.incidentId,
				type: "custom",
				title: `Checked ${(run.steps[index] as NextStep).title}: ${VERDICT_WORDS[outcome.verdict]}`,
				source: "system",
				occurredAt: checkedAt,
				metadata: JSON.stringify({
					investigationId: run.id,
					stepId,
					event: CHECKED,
					verdict: outcome.verdict,
					checkedAt: checkedAt.toISOString(),
				}),
			},
		});
		return { stepId, checkedAt: checkedAt.toISOString(), ...outcome };
	}

	/** The run and the option's rank, when `stepId` is an id this run's report stamped. */
	private async bound(stepId: string): Promise<{ run: Run; index: number }> {
		const row = await this.prisma.recommendation.findUnique({
			where: { id: stepId },
			select: { investigationId: true },
		});
		if (!row)
			throw new ORPCError("NOT_FOUND", {
				message: `Option ${stepId} not found`,
			});
		const run = await this.run(row.investigationId);
		const index = run.steps.findIndex((s) => s.id === stepId);
		if (index < 0)
			throw new ORPCError("CONFLICT", {
				message: "This report predates option ids; its options are read-only.",
			});
		return { run, index };
	}

	private async run(investigationId: string): Promise<Run> {
		const inv = await this.prisma.investigation.findUnique({
			where: { id: investigationId },
			select: { id: true, incidentId: true, report: true },
		});
		if (!inv)
			throw new ORPCError("NOT_FOUND", {
				message: `Investigation ${investigationId} not found`,
			});
		const report = safeParseJsonObject(inv.report) ?? {};
		const raw = Array.isArray(report.nextSteps) ? report.nextSteps : [];
		const steps = raw.flatMap((s) => {
			const parsed = NextStepSchema.safeParse(s);
			return parsed.success ? [parsed.data] : [];
		});
		const flagged =
			Array.isArray(report.flaggedContent) && report.flaggedContent.length > 0;
		return { id: inv.id, incidentId: inv.incidentId, steps, flagged };
	}

	private async rows(run: Run) {
		const ids = run.steps.flatMap((s) => (s.id ? [s.id] : []));
		const rows = ids.length
			? await this.prisma.recommendation.findMany({
					where: { id: { in: ids }, investigationId: run.id },
					select: { id: true, status: true, implementedAt: true },
				})
			: [];
		return new Map(rows.map((r) => [r.id, r]));
	}

	private async events(run: Run): Promise<FixEvent[]> {
		const entries = await this.prisma.timelineEntry.findMany({
			where: {
				incidentId: run.incidentId,
				type: { in: ["recommendation_completed", "custom"] },
				metadata: { contains: run.id },
			},
			select: { id: true, metadata: true, occurredAt: true },
			orderBy: { occurredAt: "asc" },
		});
		return entries.flatMap((e) => {
			const m = safeParseJsonObject(e.metadata);
			if (
				m?.investigationId !== run.id ||
				typeof m.stepId !== "string" ||
				typeof m.event !== "string"
			)
				return [];
			return [
				{
					id: e.id,
					stepId: m.stepId,
					event: m.event,
					verdict: typeof m.verdict === "string" ? m.verdict : null,
					at: e.occurredAt,
				},
			];
		});
	}

	private async option(run: Run, index: number): Promise<FixOption> {
		const [rows, events] = await Promise.all([
			this.rows(run),
			this.events(run),
		]);
		return optionOf(run.steps[index] as NextStep, index, rows, events);
	}
}

export function optionOf(
	step: NextStep,
	index: number,
	rows: Map<string, { status: string; implementedAt: Date | null }>,
	events: FixEvent[],
): FixOption {
	const row = step.id ? rows.get(step.id) : undefined;
	const appliedAt =
		row?.status === "completed" ? (row.implementedAt ?? null) : null;
	const checks = events.filter(
		(e) =>
			e.stepId === step.id &&
			e.event === CHECKED &&
			(!appliedAt || e.at >= appliedAt),
	);
	const last = checks.at(-1);
	const verdict = FixVerdictSchema.safeParse(last?.verdict);
	return {
		id: row ? (step.id ?? null) : null,
		index,
		kind: step.kind ?? "probe",
		title: step.title,
		detail: step.detail,
		command: step.command ?? null,
		facts: step.facts ?? [],
		priority: step.priority ?? null,
		readOnly: !row,
		appliedAt: appliedAt?.toISOString() ?? null,
		lastCheck:
			last && verdict.success
				? { verdict: verdict.data, at: last.at.toISOString() }
				: null,
		canUndo: !!appliedAt && checks.length === 0,
	};
}
