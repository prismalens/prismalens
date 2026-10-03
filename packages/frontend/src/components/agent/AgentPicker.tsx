// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessSetting, HarnessStatus } from "@prismalens/contracts";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/** What the current setting resolves to, for the picker and for Settings. */
export function useAgentChoice() {
	const harnessesQuery = useHarnesses();
	const settingsQuery = useHarnessSettings();
	const harnesses = harnessesQuery.data?.harnesses ?? [];
	const selection = harnessesQuery.data?.selection;
	const setting: HarnessSetting = settingsQuery.data?.harness ?? "auto";
	const effectiveId = setting === "auto" ? selection?.harness : setting;
	const effective = harnesses.find((h) => h.id === effectiveId);
	return {
		harnesses,
		selection,
		setting,
		effective,
		// Stored per harness (#639): the picker shows the effective harness's own.
		model:
			(effective && settingsQuery.data?.models?.[effective.id as HarnessId]) ??
			"",
		isLoading: harnessesQuery.isLoading || settingsQuery.isLoading,
		isError: harnessesQuery.isError,
	};
}

/** A model id by the name the agent's own list gives it, else the id as is. */
export function modelName(
	harness: HarnessStatus | undefined,
	id: string | null | undefined,
): string | null {
	if (!id) return null;
	return harness?.models.entries.find((m) => m.id === id)?.name ?? id;
}

/** The agent and model the next run starts with, as the picker names them. */
export function agentModelLabel(
	effective: HarnessStatus | undefined,
	model: string,
): { agent: string; model: string } {
	if (!effective) return { agent: "No agent", model: "" };
	if (effective.modelVia === "unsupported") {
		return { agent: effective.label, model: "its own model" };
	}
	return {
		agent: effective.label,
		model:
			modelName(
				effective,
				model || effective.envModel?.model || effective.defaultModel,
			) ?? "agent default",
	};
}

interface Option {
	value: string;
	name: string;
	line?: ReactNode;
	disabled: boolean;
	active: boolean;
	title?: string;
}

function Kbd({ children }: { children: string }) {
	return (
		<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] text-foreground">
			{children}
		</kbd>
	);
}

/**
 * The agent and model the next run starts with (#743 §4.1): one control, one
 * popover with two columns, the agents and then that agent's models by name
 * from its own list. Choosing saves at once. The same control sits in the box
 * that starts a run and in Settings. There is no field for a model id.
 */
export function AgentModelPicker({
	side = "bottom",
	className,
}: {
	side?: "top" | "bottom";
	className?: string;
}) {
	const { harnesses, selection, setting, effective, model, isLoading } =
		useAgentChoice();
	const update = useUpdateHarnessSettings();
	const [open, setOpen] = useState(false);
	const [cursor, setCursor] = useState<{ col: 0 | 1; row: number }>({
		col: 0,
		row: 0,
	});
	const ignored = effective?.modelVia === "unsupported";
	// Until the chosen agent's settings come back, the model list is the previous agent's.
	const [chosen, setChosen] = useState<string | null>(null);
	const settled = chosen === null || setting === chosen;

	const agents: Option[] = useMemo(
		() => [
			{
				value: "auto",
				name: "Auto",
				line: selection?.harness
					? `first on PATH, now ${harnesses.find((h) => h.id === selection.harness)?.label ?? selection.harness}`
					: "first agent found on PATH",
				disabled: false,
				active: setting === "auto",
			},
			...harnesses.map((h) => ({
				value: h.id,
				name: h.label,
				disabled: !h.installed,
				active: setting === h.id,
				line: h.installed ? (
					<>
						<Mono>{h.binary}</Mono>
						{h.tested && <span>tested {h.tested.version}</span>}
					</>
				) : (
					"not installed"
				),
			})),
		],
		[harnesses, selection, setting],
	);

	const models: Option[] = useMemo(() => {
		if (!effective) return [];
		if (ignored) {
			// A model stored for an agent that cannot take one blocks the run.
			return model
				? [
						{
							value: "",
							name: `Clear ${model}`,
							line: `${effective.label} cannot take a model`,
							disabled: false,
							active: false,
						},
					]
				: [];
		}
		const listed: Option[] = effective.models.entries.map((m) => ({
			value: m.id,
			name: m.name,
			title: m.id,
			line:
				m.status && m.status !== "current" ? (
					<StateWord tone="stale">{m.status}</StateWord>
				) : undefined,
			disabled: false,
			active: model === m.id,
		}));
		const stored: Option[] =
			model && !effective.models.entries.some((m) => m.id === model)
				? [
						{
							value: model,
							name: model,
							line: "not in the agent's list",
							disabled: false,
							active: true,
						},
					]
				: [];
		return [
			...stored,
			...listed,
			{
				value: "",
				name: "Agent default",
				line: effective.envModel
					? `${effective.envModel.model} · from ${effective.envModel.key}`
					: effective.defaultModel
						? `asks for ${modelName(effective, effective.defaultModel)}`
						: `whatever ${effective.label} picks`,
				disabled: false,
				active: !model,
			},
		];
	}, [effective, ignored, model]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the popover opens.
	useEffect(() => {
		if (open) {
			setCursor({
				col: 0,
				row: Math.max(
					0,
					agents.findIndex((a) => a.active),
				),
			});
		}
	}, [open]);

	// The chosen agent may take no model, and `models` lags the mutation.
	useEffect(() => {
		if (cursor.col === 1 && cursor.row >= models.length) {
			setCursor(
				models.length > 0
					? { col: 1, row: 0 }
					: {
							col: 0,
							row: Math.max(
								0,
								agents.findIndex((a) => a.active),
							),
						},
			);
		}
	}, [cursor, models.length, agents]);

	const chooseAgent = (o: Option) => {
		if (o.disabled) return;
		setChosen(o.value);
		update.mutate(
			{ harness: o.value as HarnessSetting },
			{ onError: () => setChosen(null) },
		);
		setCursor({ col: 1, row: 0 });
	};
	const chooseModel = (o: Option) => {
		if (!effective || !settled) return;
		update.mutate({ models: { [effective.id]: o.value || null } });
		setOpen(false);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const list = cursor.col === 0 ? agents : models;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setCursor((c) => ({ ...c, row: Math.min(list.length - 1, c.row + 1) }));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setCursor((c) => ({ ...c, row: Math.max(0, c.row - 1) }));
		} else if (e.key === "ArrowRight" && models.length > 0) {
			e.preventDefault();
			setCursor({
				col: 1,
				row: Math.max(
					0,
					models.findIndex((m) => m.active),
				),
			});
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			setCursor({
				col: 0,
				row: Math.max(
					0,
					agents.findIndex((a) => a.active),
				),
			});
		} else if (e.key === "Enter") {
			e.preventDefault();
			const o = list[cursor.row];
			if (o) (cursor.col === 0 ? chooseAgent : chooseModel)(o);
		}
	};

	const label = agentModelLabel(effective, model);
	const tone = effective ? (selection?.runnable ? "done" : "active") : "failed";

	const column = (
		title: string,
		options: Option[],
		col: 0 | 1,
		onChoose: (o: Option) => void,
		prefix: string,
	) => (
		<div role="listbox" aria-label={title} className="min-w-0 py-1">
			<p className="px-3 pt-1 pb-1.5 text-meta text-muted-foreground">
				{title}
			</p>
			{options.map((o, i) => (
				<div
					key={`${o.value}-${o.name}`}
					role="option"
					tabIndex={-1}
					aria-selected={o.active}
					aria-disabled={o.disabled}
					title={o.title}
					data-testid={`${prefix}-${o.value || "default"}`}
					onMouseEnter={() => setCursor({ col, row: i })}
					onMouseDown={(e) => {
						e.preventDefault();
						onChoose(o);
					}}
					className={cn(
						"flex cursor-pointer items-start gap-2 px-3 py-1.5",
						cursor.col === col && cursor.row === i && "bg-muted",
						o.disabled && "cursor-not-allowed opacity-60",
					)}
				>
					<span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
						{o.active && <Check className="h-3.5 w-3.5 text-primary" />}
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-record">{o.name}</span>
						{o.line && (
							<span className="flex items-center gap-2 truncate text-meta text-muted-foreground">
								{o.line}
							</span>
						)}
					</span>
				</div>
			))}
		</div>
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn("h-7 min-w-0 gap-1.5 px-2 text-record", className)}
					data-testid="agent-picker"
					aria-label="Agent and model for the next run"
				>
					<Sparkles
						className="h-3.5 w-3.5"
						style={{ color: `var(--run-${tone})` }}
					/>
					<span className="truncate">{isLoading ? "…" : label.agent}</span>
					{label.model && (
						<span
							className="truncate text-muted-foreground"
							data-testid="model-pill"
						>
							{label.model}
						</span>
					)}
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align="start"
				className="w-[26rem] max-w-[calc(100vw-2rem)] p-0"
				data-testid="agent-picker-list"
				onKeyDown={onKeyDown}
			>
				<div
					className={cn(
						"grid max-h-80 overflow-y-auto",
						models.length > 0 ? "grid-cols-2 divide-x" : "grid-cols-1",
					)}
				>
					{column("Agent", agents, 0, chooseAgent, "agent-option")}
					{models.length > 0 &&
						column(
							effective?.models.source === "harness"
								? `Model, from ${effective.label}`
								: "Model",
							models,
							1,
							chooseModel,
							"model-option",
						)}
				</div>
				<div className="flex flex-wrap items-center gap-3 border-t px-3 py-1.5 text-meta text-muted-foreground">
					<span className="flex items-center gap-1">
						<Kbd>←</Kbd>
						<Kbd>→</Kbd> column
					</span>
					<span className="flex items-center gap-1">
						<Kbd>↑</Kbd>
						<Kbd>↓</Kbd> move
					</span>
					<span className="flex items-center gap-1">
						<Kbd>Enter</Kbd> choose
					</span>
					<span className="flex items-center gap-1">
						<Kbd>Esc</Kbd> close
					</span>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** The agent and model a live run is fixed on, read-only (#743 §6). */
export function AgentModelChip({
	agent,
	model,
	className,
}: {
	agent: string;
	model?: string | null;
	className?: string;
}) {
	return (
		<span
			title="Fixed for this run"
			className={cn(
				"inline-flex h-7 min-w-0 items-center gap-1.5 px-2 text-record text-muted-foreground",
				className,
			)}
			data-testid="agent-chip"
		>
			<Sparkles className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">{agent}</span>
			{model && <span className="truncate">{model}</span>}
		</span>
	);
}
