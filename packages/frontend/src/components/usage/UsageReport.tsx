// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	UsageBucket,
	UsageModel,
	UsageSummary,
} from "@prismalens/contracts";
import { useState } from "react";
import { Segmented } from "@/components/shared/Segmented";
import { Empty } from "@/components/shared/State";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ModelCard } from "./ModelCard";
import { UsageChart, type UsageMeasure } from "./UsageChart";
import {
	agentName,
	bucketLabel,
	countOf,
	formatCost,
	formatShare,
	formatTokens,
	listNames,
	share,
} from "./usage-math";

type Breakdown = "model" | "day";
const ESTIMATE = "Estimate, from what the agents reported.";

/** Agents that ran in range but sent no usage, said plainly. */
export function SilentAgentsNote({ agents }: { agents: string[] }) {
	if (agents.length === 0) return null;
	return (
		<p className="text-meta text-text-2" data-testid="usage-silent-agents">
			{listNames(agents.map(agentName))} reported no usage for{" "}
			{agents.length === 1 ? "these runs" : "their runs"}.
		</p>
	);
}

function Headline({
	summary,
	measure,
}: {
	summary: UsageSummary;
	measure: UsageMeasure;
}) {
	const { totals } = summary;
	const value =
		measure === "tokens"
			? formatTokens(totals.tokens.total)
			: formatCost(totals.cost.amount, totals.cost.currency);
	return (
		<div className="grid gap-1">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span
					className="text-display text-text-1 tabular-nums"
					data-testid="usage-headline"
				>
					{value}
				</span>
				<span className="text-body text-text-2">
					{measure === "tokens" ? "tokens, " : ""}
					{countOf(summary.threads, "thread")}
				</span>
			</div>
			{measure === "cost" && (
				<p className="text-meta text-text-3">{ESTIMATE}</p>
			)}
			{measure === "cost" && totals.cost.unpricedTurns > 0 && (
				<p className="text-meta text-text-2" data-testid="usage-unpriced">
					{countOf(totals.cost.unpricedTurns, "turn")} reported no cost
					{totals.cost.amount === null
						? "."
						: ", so the total leaves them out."}
				</p>
			)}
		</div>
	);
}

function TokenCells({
	bucket,
	whole,
	measure,
}: {
	bucket: UsageBucket;
	whole: UsageBucket;
	measure: UsageMeasure;
}) {
	const part =
		measure === "tokens"
			? share(bucket.tokens.total, whole.tokens.total)
			: share(bucket.cost.amount ?? 0, whole.cost.amount ?? 0);
	const num = "text-right tabular-nums";
	return (
		<>
			{measure === "tokens" && (
				<>
					<TableCell className={num}>
						{formatTokens(bucket.tokens.input)}
					</TableCell>
					<TableCell className={num}>
						{formatTokens(bucket.tokens.output)}
					</TableCell>
					<TableCell className={num}>
						{formatTokens(bucket.tokens.cacheRead)}
					</TableCell>
					<TableCell className={num}>
						{formatTokens(bucket.tokens.cacheWrite)}
					</TableCell>
				</>
			)}
			<TableCell className={num}>{formatTokens(bucket.tokens.total)}</TableCell>
			<TableCell className={num}>{formatShare(part)}</TableCell>
			<TableCell className={num}>
				{formatCost(bucket.cost.amount, bucket.cost.currency)}
			</TableCell>
		</>
	);
}

function BreakdownTable({
	summary,
	measure,
	by,
	onOpenModel,
}: {
	summary: UsageSummary;
	measure: UsageMeasure;
	by: Breakdown;
	onOpenModel: (model: UsageModel) => void;
}) {
	const head = "text-right";
	const days = summary.days.filter((d) => d.turns > 0).reverse();
	return (
		<Table data-testid={`usage-breakdown-${by}`}>
			<TableHeader>
				<TableRow>
					<TableHead>
						{by === "model"
							? "Model"
							: summary.step === "hour"
								? "Hour"
								: "Day"}
					</TableHead>
					{measure === "tokens" && (
						<>
							<TableHead className={head}>Input</TableHead>
							<TableHead className={head}>Output</TableHead>
							<TableHead className={head}>Cache read</TableHead>
							<TableHead className={head}>Cache write</TableHead>
						</>
					)}
					<TableHead className={head}>Tokens</TableHead>
					<TableHead className={head}>Share</TableHead>
					<TableHead className={head}>Cost, estimate</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{by === "model"
					? summary.models.map((m) => (
							<TableRow key={`${m.agent ?? ""}:${m.model}`}>
								<TableCell>
									<button
										type="button"
										className="flex min-h-11 min-w-0 flex-col items-start justify-center text-left"
										onClick={() => onOpenModel(m)}
										data-testid="usage-model-row"
									>
										<span className="font-medium text-text-1 underline-offset-2 hover:underline">
											{m.model}
										</span>
										{m.agent && (
											<span className="text-meta text-text-3">
												{agentName(m.agent)}
											</span>
										)}
									</button>
								</TableCell>
								<TokenCells
									bucket={m}
									whole={summary.totals}
									measure={measure}
								/>
							</TableRow>
						))
					: days.map((d) => (
							<TableRow key={d.day}>
								<TableCell className="h-11 whitespace-nowrap">
									{bucketLabel(d.day, summary.step)}
								</TableCell>
								<TokenCells
									bucket={d}
									whole={summary.totals}
									measure={measure}
								/>
							</TableRow>
						))}
			</TableBody>
		</Table>
	);
}

/** The Tokens or Cost tab for one summary: headline, chart, breakdown and a model's card. */
export function UsageReport({
	summary,
	measure,
}: {
	summary: UsageSummary;
	measure: UsageMeasure;
}) {
	const [by, setBy] = useState<Breakdown>("model");
	const [open, setOpen] = useState<UsageModel | null>(null);
	if (summary.totals.turns === 0)
		return (
			<div className="grid gap-2" data-testid="usage-empty">
				<Empty text="No usage in this range." />
				<SilentAgentsNote agents={summary.silentAgents} />
			</div>
		);
	return (
		<div className="grid min-w-0 gap-5" data-testid={`usage-${measure}`}>
			<Headline summary={summary} measure={measure} />
			<UsageChart
				days={summary.days}
				step={summary.step}
				measure={measure}
				label={
					measure === "tokens"
						? `Tokens per ${summary.step}`
						: `Estimated cost per ${summary.step}`
				}
			/>
			<SilentAgentsNote agents={summary.silentAgents} />
			<section className="grid min-w-0 gap-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-body font-medium text-text-2">Breakdown</h3>
					<Segmented
						label="Break down by"
						value={by}
						onChange={setBy}
						options={[
							{ value: "model", label: "Model" },
							{ value: "day", label: summary.step === "hour" ? "Hour" : "Day" },
						]}
						className="max-sm:[&_button]:h-10"
						testId="usage-breakdown-by"
					/>
				</div>
				<BreakdownTable
					summary={summary}
					measure={measure}
					by={by}
					onOpenModel={setOpen}
				/>
			</section>
			<ModelCard
				model={open}
				step={summary.step}
				onClose={() => setOpen(null)}
			/>
		</div>
	);
}

export function UsageTokens({ summary }: { summary: UsageSummary }) {
	return <UsageReport summary={summary} measure="tokens" />;
}

export function UsageCost({ summary }: { summary: UsageSummary }) {
	return <UsageReport summary={summary} measure="cost" />;
}
