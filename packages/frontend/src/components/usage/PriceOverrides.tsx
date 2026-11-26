// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ModelPrice } from "@prismalens/contracts";
import { useId, useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { fact } from "@/components/kit/fact";
import { Picker } from "@/components/kit/Picker";
import { settingOf } from "@/components/kit/registry";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Empty, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	useSetUsagePrices,
	useUsagePrices,
} from "@/lib/api/hooks/use-usage-orpc";
import { agentName, modelName } from "./usage-math";

/** The words a price's route reads as: `Any route` when it names no provider. */
export const routeWord = (provider: string | null) => provider ?? "Any route";

const money = (n: number) => `$${n}`;

/** `$3 in, $15 out per million`, with the cache prices when set. */
export function priceLine(p: ModelPrice): string {
	const m = p.perMillion;
	const parts = [`${money(m.input)} in`, `${money(m.output)} out`];
	if (m.cacheRead !== undefined) parts.push(`${money(m.cacheRead)} cache read`);
	if (m.cacheWrite !== undefined)
		parts.push(`${money(m.cacheWrite)} cache write`);
	return `${parts.join(", ")} per million`;
}

const num = (v: string): number | undefined => {
	if (v.trim() === "") return undefined;
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** An optional price: empty falls back, anything else must be a price. */
const blankOrPrice = (v: string) => v.trim() === "" || num(v) !== undefined;

/** One price to add: agent, model, route and dollars per million tokens. */
export function PriceForm({
	agents,
	initial,
	onSave,
	onCancel,
	saving,
}: {
	agents: readonly string[];
	initial?: { agent?: string; model?: string };
	onSave: (price: ModelPrice) => void;
	onCancel: () => void;
	saving?: boolean;
}) {
	const uid = useId();
	const [agent, setAgent] = useState(initial?.agent ?? agents[0] ?? "");
	const [model, setModel] = useState(initial?.model ?? "");
	const [route, setRoute] = useState("");
	const [input, setInput] = useState("");
	const [output, setOutput] = useState("");
	const [cacheRead, setCacheRead] = useState("");
	const [cacheWrite, setCacheWrite] = useState("");
	const inP = num(input);
	const outP = num(output);
	const ready =
		!!agent &&
		model.trim() !== "" &&
		inP !== undefined &&
		outP !== undefined &&
		blankOrPrice(cacheRead) &&
		blankOrPrice(cacheWrite);
	const field = (
		label: string,
		value: string,
		set: (v: string) => void,
		testId: string,
	) => (
		<div className="grid min-w-0 gap-1 text-meta text-text-2">
			<label htmlFor={`${uid}-${testId}`}>{label}</label>
			<Input
				id={`${uid}-${testId}`}
				inputMode="decimal"
				value={value}
				onChange={(e) => set(e.target.value)}
				placeholder="$ per million"
				data-testid={testId}
			/>
		</div>
	);
	return (
		<form
			className="grid min-w-0 gap-3 py-3"
			data-testid="price-form"
			onSubmit={(e) => {
				e.preventDefault();
				if (!ready || inP === undefined || outP === undefined) return;
				const cr = num(cacheRead);
				const cw = num(cacheWrite);
				onSave({
					agent,
					provider: route.trim() || null,
					model: model.trim(),
					perMillion: {
						input: inP,
						output: outP,
						...(cr !== undefined ? { cacheRead: cr } : {}),
						...(cw !== undefined ? { cacheWrite: cw } : {}),
					},
				});
			}}
		>
			<div className="grid min-w-0 gap-3 sm:grid-cols-3">
				<div className="grid min-w-0 gap-1 text-meta text-text-2">
					Agent
					<Picker
						label="Agent"
						side="bottom"
						value={agent}
						onChange={setAgent}
						options={agents.map((id) => ({
							id,
							name: agentName(id),
							mark: <AgentMark id={id} className="size-3.5" />,
						}))}
						testId="price-agent"
					/>
				</div>
				<div className="grid min-w-0 gap-1 text-meta text-text-2">
					<label htmlFor={`${uid}-price-model`}>Model</label>
					<Input
						id={`${uid}-price-model`}
						value={model}
						onChange={(e) => setModel(e.target.value)}
						maxLength={200}
						data-testid="price-model"
					/>
				</div>
				<div className="grid min-w-0 gap-1 text-meta text-text-2">
					<label htmlFor={`${uid}-price-route`}>Route</label>
					<Input
						id={`${uid}-price-route`}
						value={route}
						onChange={(e) => setRoute(e.target.value)}
						placeholder="Any route"
						maxLength={100}
						data-testid="price-route"
					/>
				</div>
			</div>
			<div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
				{field("Input", input, setInput, "price-input")}
				{field("Output", output, setOutput, "price-output")}
				{field("Cache read", cacheRead, setCacheRead, "price-cache-read")}
				{field("Cache write", cacheWrite, setCacheWrite, "price-cache-write")}
			</div>
			<div className="flex gap-2">
				<Button
					type="submit"
					variant="secondary"
					disabled={!ready || saving}
					data-testid="price-save"
				>
					Save
				</Button>
				<Button type="button" variant="text" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	);
}

/** A save that the server refused; the form or row stays for a retry. */
export function SaveFailed() {
	return (
		<p
			role="alert"
			className="text-body text-danger"
			data-testid="price-save-failed"
		>
			Your price did not save.
		</p>
	);
}

/** Adds one price to the stored list; the same agent, route and model replaces the old one. */
export function useAddPrice() {
	const query = useUsagePrices();
	const save = useSetUsagePrices();
	const prices = query.data?.prices;
	// A save replaces the whole list, so it needs the stored one and no save in flight.
	const blocked = !prices || save.isPending;
	return {
		prices,
		blocked,
		failed: !prices && query.isError,
		// Cleared by the next save: mutate resets the mutation's error.
		saveFailed: save.isError,
		retry: () => void query.refetch(),
		add: (p: ModelPrice, then?: () => void) => {
			if (!prices || save.isPending) return;
			save.mutate(
				{
					prices: [
						...prices.filter(
							(x) =>
								!(
									x.agent === p.agent &&
									x.provider === p.provider &&
									x.model === p.model
								),
						),
						p,
					],
				},
				{ onSuccess: () => then?.() },
			);
		},
		remove: (p: ModelPrice) => {
			if (!prices || save.isPending) return;
			save.mutate({ prices: prices.filter((x) => x !== p) });
		},
	};
}

/** Settings → Usage → Prices: API prices for models whose agent reports no cost (#1180). */
export function PriceOverrides({ agents }: { agents: readonly string[] }) {
	const s = settingOf("usage.prices");
	const { prices, add, remove, blocked, failed, saveFailed, retry } =
		useAddPrice();
	const [adding, setAdding] = useState(false);
	return (
		<SettingGroup
			title={s.label}
			description={s.sentence}
			testId={s.anchor}
			actions={
				!adding && (
					<Button
						variant="text"
						size="sm"
						onClick={() => setAdding(true)}
						data-testid="price-add"
					>
						Add price
					</Button>
				)
			}
		>
			<Pool>
				{failed && <Problem text="Your prices did not load." onRetry={retry} />}
				{saveFailed && <SaveFailed />}
				{prices?.length === 0 && !adding && <Empty text="No prices yet" />}
				{prices?.map((p) => (
					<SettingRow
						key={`${p.agent}:${p.provider ?? ""}:${p.model}`}
						label={
							<span className="break-all" {...fact("model")}>
								{modelName(p.model)}
							</span>
						}
						description={
							<span data-testid="price-line">
								{`${agentName(p.agent)}, ${routeWord(p.provider)}. ${priceLine(p)}`}
							</span>
						}
						testId="price-row"
					>
						<Button
							variant="text"
							size="sm"
							disabled={blocked}
							onClick={() => remove(p)}
						>
							Remove
						</Button>
					</SettingRow>
				))}
				{adding && (
					<PriceForm
						agents={agents}
						saving={blocked}
						onSave={(p) => add(p, () => setAdding(false))}
						onCancel={() => setAdding(false)}
					/>
				)}
			</Pool>
		</SettingGroup>
	);
}
