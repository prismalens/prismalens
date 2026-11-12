// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageModel } from "@prismalens/contracts";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { UsageChart } from "./UsageChart";
import {
	agentName,
	cacheHitRate,
	costPerMillion,
	countOf,
	formatCost,
	formatShare,
	formatTokens,
} from "./usage-math";

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 items-baseline justify-between gap-3 py-2 relative after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-hairline first:after:hidden">
			<dt className="text-body text-text-2">{label}</dt>
			<dd className="text-body font-medium text-text-1 tabular-nums">
				{value}
			</dd>
		</div>
	);
}

/** The card's contents, without the dialog, so the design gallery can show it in place. */
export function ModelCardBody({
	model,
	step,
}: {
	model: UsageModel;
	step: "hour" | "day";
}) {
	const { tokens, cost } = model;
	const hit = cacheHitRate(tokens);
	const perMillion = costPerMillion(cost.amount, tokens.total);
	return (
		<div className="grid min-w-0 gap-4" data-testid="usage-model-card">
			<dl>
				<Fact
					label="Cost, estimate"
					value={formatCost(cost.amount, cost.currency)}
				/>
				<Fact
					label="Per million tokens"
					value={
						perMillion === null
							? "Unpriced"
							: formatCost(perMillion, cost.currency)
					}
				/>
				<Fact
					label="Cache hit rate"
					value={hit === null ? "No cache reads reported" : formatShare(hit)}
				/>
				<Fact label="Input" value={formatTokens(tokens.input)} />
				<Fact label="Output" value={formatTokens(tokens.output)} />
				<Fact label="Cache read" value={formatTokens(tokens.cacheRead)} />
				<Fact label="Cache write" value={formatTokens(tokens.cacheWrite)} />
				<Fact label="Total tokens" value={formatTokens(tokens.total)} />
			</dl>
			{cost.unpricedTurns > 0 && cost.amount !== null && (
				<p className="text-meta text-text-3">
					{countOf(cost.unpricedTurns, "turn")} reported no cost, so the
					estimate leaves them out.
				</p>
			)}
			<UsageChart
				days={model.days}
				step={step}
				measure="tokens"
				height={120}
				label={`Tokens over time for ${model.model}`}
			/>
		</div>
	);
}

/** A model's card: cost, tokens by type, cache hit rate and its own chart. */
export function ModelCard({
	model,
	step,
	onClose,
}: {
	model: UsageModel | null;
	step: "hour" | "day";
	onClose: () => void;
}) {
	return (
		<Dialog open={model !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent size="md">
				{model && (
					<>
						<DialogHeader>
							<DialogTitle className="break-all">{model.model}</DialogTitle>
							<DialogDescription>
								{model.agent ? `${agentName(model.agent)}, ` : ""}
								{countOf(model.turns, "turn")}. Cost is an estimate, from what
								the agent reported.
							</DialogDescription>
						</DialogHeader>
						<ModelCardBody model={model} step={step} />
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
