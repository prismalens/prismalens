// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVELS,
	type AccessLevel,
	type HarnessId,
} from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	ACCESS_LEVEL_LINE,
	type AxisSource,
	effectiveAccess,
	type FavouriteModel,
	type HarnessSetting,
	type HarnessStatus,
} from "@prismalens/contracts";
import { Check, ChevronDown, Lock, Star } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import {
	ModelSelector,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
} from "@/components/ai/model-selector";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	defaultTag,
	levelIcon,
	levelRowLine,
	levelSandbox,
	sandboxLine,
} from "@/lib/access-levels";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { AgentMark, StarredMark } from "./AgentMark";
import { focusChosen, roveKeys } from "./rove";

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
		model:
			(effective && settingsQuery.data?.models?.[effective.id as HarnessId]) ??
			"",
		models: settingsQuery.data?.models ?? {},
		favourites: settingsQuery.data?.favourites ?? [],
		efforts: settingsQuery.data?.efforts ?? {},
		axes: {
			accessLevels: settingsQuery.data?.accessLevels ?? {},
			autoAccessLevels: settingsQuery.data?.autoAccessLevels ?? {},
		},
		customModels: settingsQuery.data?.customModels ?? {},
		isLoading: harnessesQuery.isLoading || settingsQuery.isLoading,
		isError: harnessesQuery.isError,
	};
}

type Axes = ReturnType<typeof useAgentChoice>["axes"];

/** The level a run on `agent` takes when the box names none, and where it came from (#673 w21). */
export function defaultAccessOf(
	agent: HarnessStatus | undefined,
	axes: Axes,
	autoStart = false,
): { level: { level: AccessLevel; from: AxisSource } } {
	if (!agent) return { level: { level: "supervised", from: "prismalens" } };
	const id = agent.id as HarnessId;
	return {
		level: effectiveAccess(axes, id, agent.localDefault?.permission, autoStart),
	};
}

/** `OpenCode Zen/Muse Spark 1.3 Free` is `Muse Spark 1.3 Free` under its provider's heading. */
function withoutProvider(name: string, provider: string): string {
	const prefix = `${provider}/`;
	return name.toLowerCase().startsWith(prefix.toLowerCase())
		? name.slice(prefix.length).trim() || name
		: name;
}

/** `Sonnet 4.5` and `sonnet-4-5` compare equal; `Nova 13` and `Nova 1.3` do not (#805). */
const comparable = (s: string) =>
	s
		.toLowerCase()
		.replace(/(\d)[.\-_ ](?=\d)/g, "$1.")
		.replace(/[^a-z0-9.]/g, "");

/**
 * A model by the name the agent's own list gives it, less the provider
 * prefix, else the id as is. A served model the agent names its own way
 * (`Muse Spark 1.3 (free)`) takes the list's name too: one name everywhere (#673 f7).
 */
export function modelName(
	harness: HarnessStatus | undefined,
	id: string | null | undefined,
): string | null {
	if (!id) return null;
	const entries = harness?.models.entries ?? [];
	const named = (m: { id: string; name?: string | null }) =>
		withoutProvider(m.name ?? m.id, providerOf(harness?.id ?? "", m.id));
	const exact = entries.find((m) => m.id === id);
	if (exact) return named(exact);
	const key = comparable(id);
	const alike = entries.filter(
		(m) => comparable(named(m)) === key || comparable(m.name ?? "") === key,
	);
	// Two models that read alike leave the id as the one unambiguous name.
	return alike.length === 1 && alike[0] ? named(alike[0]) : id;
}

/** The model the agent picks for itself, when its check or the env says. */
function resolvedModel(h: HarnessStatus): string | null {
	return modelName(h, h.envModel?.model || h.checked?.servedModel || null);
}

/** The default row's line: the model the agent picks, and where the env named it (#673 w57). */
export function defaultModelLine(h: HarnessStatus): string | undefined {
	const model = resolvedModel(h);
	if (!model) return undefined;
	return h.envModel ? `${model}, from your environment` : model;
}

/** The agent and model the next run starts with, each named once. */
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
			modelName(effective, model || resolvedModel(effective)) ??
			"agent default",
	};
}

/** The chip's words for a model: never a bare default with no model named (#673 w7). */
export function chipModel(h: HarnessStatus | undefined, model: string): string {
	if (!h) return "No agent";
	if (h.modelVia === "unsupported") return h.label;
	return modelName(h, model || resolvedModel(h)) ?? `${h.label} default`;
}

/** Why an installed agent cannot take a run, in the gate's words; null when it can. */
export function unreadyReason(h: HarnessStatus): string | null {
	if (!h.installed || !h.checked || h.checked.outcome === "answers-acp")
		return null;
	return `${h.label}: ${h.checked.detail}`;
}

function modelState(h: HarnessStatus): "list" | "pending" | "own" {
	if (h.modelVia === "unsupported")
		return h.id === "deepagents" ? "own" : "pending";
	return h.checked || h.models.entries.length > 0 ? "list" : "pending";
}

const PROVIDERS: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	opencode: "OpenCode Zen",
	"github-copilot": "GitHub Copilot",
	openrouter: "OpenRouter",
	xai: "xAI",
	mistral: "Mistral",
	deepseek: "DeepSeek",
	ollama: "Ollama",
};
const VENDOR: Record<string, string> = {
	"claude-code": "Anthropic",
	codex: "OpenAI",
	gemini: "Google",
};
/** A provider's mark where an agent mark is the same company's. */
const PROVIDER_MARK: Record<string, string> = {
	Anthropic: "claude-code",
	Google: "gemini",
	"OpenCode Zen": "opencode",
};

/** The provider a model id lists under: its prefix, else the agent's own vendor. */
export function providerOf(harnessId: string, modelId: string): string {
	const slash = modelId.indexOf("/");
	if (slash > 0) {
		const prefix = modelId.slice(0, slash);
		return (
			PROVIDERS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1)
		);
	}
	if (/:[\w.-]*cloud$|^[\w.-]+:\d/.test(modelId)) return "Ollama";
	return VENDOR[harnessId] ?? "Models";
}

const isStarred = (f: FavouriteModel[], harness: string, model: string) =>
	f.some((x) => x.harness === harness && x.model === model);

/** The chip every box control shares: ghost, h-8, 13/500, a 14 px caret. */
export const CHIP =
	"inline-flex h-8 min-w-0 shrink-0 items-center gap-1 rounded-control px-2 text-body font-medium whitespace-nowrap text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 data-[state=open]:bg-surface-3 data-[state=open]:text-text-1 disabled:cursor-default disabled:text-text-3 disabled:hover:bg-transparent";

function Caret() {
	return <ChevronDown className="size-3.5 shrink-0 text-text-3" aria-hidden />;
}

interface Row {
	key: string;
	harness: HarnessStatus;
	model: string;
	name: string;
	provider: string;
	warn?: string;
	legacy?: boolean;
}

/**
 * The agent and model chip (#673 w7): a 44 px rail of installed
 * agents and a cmdk list of the shown agent's models, fixed at 380 × 400.
 */
export function ModelChip({
	harness,
	model,
	onPick,
	disabled,
	side = "top",
	className,
}: {
	harness: HarnessStatus | undefined;
	model: string;
	onPick: (harness: HarnessStatus, model: string) => void;
	disabled?: boolean;
	side?: "top" | "bottom";
	className?: string;
}) {
	const { harnesses, favourites, models, customModels, isLoading } =
		useAgentChoice();
	const update = useUpdateHarnessSettings();
	const check = useCheckHarness();
	const [open, setOpen] = useState(false);
	const [tile, setTile] = useState<string | null>(null);
	const shown = tile ?? harness?.id ?? "starred";
	const agent = harnesses.find((h) => h.id === shown);
	const installed = harnesses.filter((h) => h.installed);

	const row = (h: HarnessStatus, id: string, key: string): Row => {
		const m = h.models.entries.find((e) => e.id === id);
		return {
			key: `${key}:${h.id}:${id}`,
			harness: h,
			model: id,
			name: modelName(h, id) ?? id,
			provider: shown === "starred" ? h.label : providerOf(h.id, id),
			// The agent still lists it but marks it on the way out (#639).
			...(m?.status === "legacy" ? { legacy: true } : {}),
			// A free tier that trains on what it is sent says so on its row.
			...(m?.status === "training" ? { warn: "trains on your prompts" } : {}),
		};
	};
	let rows: Row[] = [];
	if (shown === "starred") {
		rows = favourites.flatMap((f) => {
			const h = harnesses.find((x) => x.id === f.harness);
			return h?.installed ? [row(h, f.model, "star")] : [];
		});
	} else if (agent && modelState(agent) === "list") {
		const listed = agent.models.entries.map((m) => row(agent, m.id, "m"));
		const order = Array.from(new Set(listed.map((r) => r.provider)));
		listed.sort(
			(a, b) =>
				Number(isStarred(favourites, b.harness.id, b.model)) -
					Number(isStarred(favourites, a.harness.id, a.model)) ||
				order.indexOf(a.provider) - order.indexOf(b.provider),
		);
		const listedIds = new Set(agent.models.entries.map((m) => m.id));
		// Ids the operator added in Settings, Agent; the agent's own list may not hold them (#673 w57).
		const added = (customModels[agent.id as HarnessId] ?? [])
			.filter((id) => !listedIds.has(id))
			.map((id) => ({ ...row(agent, id, "c"), provider: "Added by you" }));
		const stored = models[agent.id as HarnessId];
		const unknown =
			stored &&
			!listedIds.has(stored) &&
			!customModels[agent.id as HarnessId]?.includes(stored)
				? [
						{
							...row(agent, stored, "u"),
							warn: `Not confirmed for ${agent.label}`,
						},
					]
				: [];
		rows = [...unknown, ...added, ...listed];
	}

	const chosen = (h: HarnessStatus, id: string) =>
		harness?.id === h.id && model === id;
	const pick = (h: HarnessStatus, id: string) => {
		setOpen(false);
		if (!chosen(h, id)) onPick(h, id);
	};
	const star = (h: HarnessStatus, id: string) =>
		update.mutate({
			favourites: isStarred(favourites, h.id, id)
				? favourites.filter((f) => !(f.harness === h.id && f.model === id))
				: [...favourites, { harness: h.id as HarnessId, model: id }],
		});

	// The rail is one tab stop: Up and Down move along it and show that agent, Right goes to the search.
	const rail = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const tiles = [
		"starred",
		...installed.filter((h) => !unreadyReason(h)).map((h) => h.id),
	];
	const onRailKeys = (e: KeyboardEvent<HTMLDivElement>) => {
		// The shown agent may be off the rail (stored, then uninstalled): Down takes the first, Up the last.
		const found = tiles.indexOf(shown);
		const at = found === -1 ? (e.key === "ArrowUp" ? 0 : -1) : found;
		const go = (i: number) => {
			e.preventDefault();
			const next = tiles[(i + tiles.length) % tiles.length];
			if (!next) return;
			setTile(next);
			rail.current
				?.querySelector<HTMLElement>(`[data-tile="${next}"]`)
				?.focus();
		};
		if (e.key === "ArrowDown") go(at + 1);
		else if (e.key === "ArrowUp") go(at - 1);
		else if (e.key === "Home") go(0);
		else if (e.key === "End") go(tiles.length - 1);
		else if (e.key === "ArrowRight") {
			e.preventDefault();
			search.current?.focus();
		}
	};

	const label = isLoading ? "…" : chipModel(harness, model);
	return (
		<Popover
			open={open}
			onOpenChange={(o) => {
				setOpen(o);
				if (o) setTile(null);
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className={cn(CHIP, "max-w-56", className)}
					data-testid="agent-picker"
					aria-label={`Agent and model: ${harness?.label ?? "none"}, ${label}`}
				>
					{harness && <AgentMark id={harness.id} />}
					<span className="truncate" data-testid="model-pill">
						{label}
					</span>
					<Caret />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align="start"
				sideOffset={6}
				className="grid h-[400px] w-[min(380px,calc(100vw-32px))] grid-cols-[44px_minmax(0,1fr)] overflow-hidden rounded-surface p-0"
				data-testid="agent-picker-list"
				aria-label="Agent and model"
				onOpenAutoFocus={(e) => {
					// The search takes the keys, so Enter picks the highlighted row.
					e.preventDefault();
					search.current?.focus();
				}}
			>
				<div
					ref={rail}
					role="tablist"
					aria-orientation="vertical"
					aria-label="Agents"
					onKeyDown={onRailKeys}
					className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto bg-surface-1 py-1.5 [scrollbar-width:none]"
					data-testid="picker-rail"
				>
					<RailTile
						on={shown === "starred"}
						label="Starred"
						onClick={() => setTile("starred")}
						testId="rail-starred"
					>
						<StarredMark className="size-[18px]" />
					</RailTile>
					{installed.map((h) => {
						const why = unreadyReason(h);
						return (
							<RailTile
								key={h.id}
								on={shown === h.id}
								off={!!why}
								label={why ?? h.label}
								onClick={() => {
									if (!why) setTile(h.id);
								}}
								testId={`rail-${h.id}`}
							>
								<AgentMark id={h.id} className="size-5" />
							</RailTile>
						);
					})}
				</div>
				<ModelSelector
					key={shown}
					className="min-h-0"
					loop
					filter={containsFilter}
				>
					<ModelSelectorInput
						ref={search}
						onKeyDown={(e) => {
							// Left at the start of the search goes back to the rail, as Right came from it.
							if (e.key !== "ArrowLeft" || e.currentTarget.selectionStart)
								return;
							e.preventDefault();
							rail.current
								?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')
								?.focus();
						}}
						placeholder={
							shown === "starred"
								? "Search starred models"
								: `Search ${agent?.label ?? ""} models`
						}
						data-testid="picker-search"
					/>
					<ModelSelectorList label="Models" className="[scrollbar-width:thin]">
						<ModelSelectorEmpty>
							{shown === "starred" && favourites.length === 0
								? "Star a model under any agent and it lists here."
								: "No model matches."}
						</ModelSelectorEmpty>
						<ModelSelectorGroup>
							{agent && shown !== "starred" && (
								<ModelSelectorItem
									value={`${agent.label} default`}
									onSelect={() => pick(agent, "")}
									data-testid="model-default"
									data-checked={chosen(agent, "") ? "" : undefined}
								>
									<RowText
										name="Agent's own model"
										sub={defaultModelLine(agent)}
									/>
									{chosen(agent, "") && <Tick />}
									<span className="w-6 shrink-0" />
								</ModelSelectorItem>
							)}
							{rows.map((r) => (
								<ModelSelectorItem
									key={r.key}
									value={`${r.name} ${r.model} ${r.key}`}
									onSelect={() => pick(r.harness, r.model)}
									data-testid="model-option"
									data-model={r.name}
								>
									<RowText
										name={r.name}
										sub={
											r.warn ??
											(r.legacy ? `${r.provider}, legacy` : r.provider)
										}
										warn={!!r.warn}
										mark={
											shown === "starred"
												? r.harness.id
												: PROVIDER_MARK[r.provider]
										}
									/>
									{chosen(r.harness, r.model) && <Tick />}
									<button
										type="button"
										aria-label={
											isStarred(favourites, r.harness.id, r.model)
												? `Unstar ${r.name}`
												: `Star ${r.name}`
										}
										aria-pressed={isStarred(favourites, r.harness.id, r.model)}
										onPointerDown={(e) => {
											e.preventDefault();
											e.stopPropagation();
											star(r.harness, r.model);
										}}
										onClick={(e) => {
											// cmdk selects the row on click; the star must not.
											e.preventDefault();
											e.stopPropagation();
										}}
										onKeyDown={(e) => {
											// cmdk takes Enter for the row; a focused star keeps it.
											if (e.key !== "Enter" && e.key !== " ") return;
											e.preventDefault();
											e.stopPropagation();
											star(r.harness, r.model);
										}}
										className="inline-flex size-6 shrink-0 items-center justify-center rounded-[4px] text-text-3 hover:bg-surface-4"
										data-testid="model-star"
									>
										<Star
											className={cn(
												"size-3.5",
												isStarred(favourites, r.harness.id, r.model) &&
													"fill-warn text-warn",
											)}
										/>
									</button>
								</ModelSelectorItem>
							))}
						</ModelSelectorGroup>
						{agent &&
							shown !== "starred" &&
							modelState(agent) === "pending" && (
								<div
									className="flex items-center gap-2 px-3 py-2 text-body text-text-2"
									data-testid="model-pending"
								>
									<span className="min-w-0 flex-1">
										Run a check to list models
									</span>
									<Button
										variant="secondary"
										size="sm"
										disabled={check.isPending}
										onClick={() => check.mutate({ id: agent.id as HarnessId })}
									>
										{check.isPending ? "Checking" : "Check"}
									</Button>
								</div>
							)}
					</ModelSelectorList>
				</ModelSelector>
			</PopoverContent>
		</Popover>
	);
}

/** Rows whose words contain the search, not cmdk's fuzzy letter match. */
const containsFilter = (value: string, query: string) =>
	value.toLowerCase().includes(query.trim().toLowerCase()) ? 1 : 0;

function Tick() {
	return <Check className="size-4 shrink-0 text-text-1" aria-hidden />;
}

function RowText({
	name,
	sub,
	warn,
	mark,
}: {
	name: string;
	sub?: string;
	warn?: boolean;
	mark?: string;
}) {
	return (
		<span className="grid min-w-0 flex-1 gap-0.5">
			{/* A long name wraps to a second line rather than cut (#673 f7). */}
			<span className="line-clamp-2 text-body font-semibold [overflow-wrap:anywhere] text-text-1">
				{name}
			</span>
			{sub && (
				<span
					className={cn(
						"flex min-w-0 items-center gap-1.5 truncate text-meta whitespace-nowrap",
						warn ? "text-warn" : "text-text-2",
					)}
				>
					{mark && <AgentMark id={mark} className="size-3" />}
					<span className="truncate">{sub}</span>
				</span>
			)}
		</span>
	);
}

function RailTile({
	on,
	off,
	label,
	onClick,
	testId,
	children,
}: {
	on: boolean;
	off?: boolean;
	label: string;
	onClick: () => void;
	testId: string;
	children: ReactNode;
}) {
	return (
		<Hint label={label} side="left">
			<button
				type="button"
				role="tab"
				aria-selected={on}
				aria-disabled={off}
				aria-label={label}
				tabIndex={on ? 0 : -1}
				onClick={onClick}
				className={cn(
					"relative inline-flex size-9 shrink-0 items-center justify-center rounded-control text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3",
					on &&
						"bg-surface-3 text-text-1 before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent",
					off && "cursor-default opacity-40 hover:bg-transparent",
				)}
				data-testid={testId}
				data-tile={testId.replace(/^rail-/, "")}
				data-off={off ? "" : undefined}
			>
				{children}
			</button>
		</Hint>
	);
}

/** An agent's effort levels by its own names, the model's default marked. */
export function effortLevels(
	h: HarnessStatus | undefined,
): { id: string; name: string; default: boolean }[] {
	const listed = h?.checked?.efforts;
	if (listed?.length) return listed;
	const offered = h?.checked?.effort;
	if (!offered) return [];
	return offered.values.map((v) => ({
		id: v,
		name: v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " "),
		default: v === offered.default,
	}));
}

/** Claude Code takes its 1M window as a model alias; no other agent offers a choice. */
const WINDOW_ALIAS = "[1m]";
const windowOf = (model: string) =>
	model.endsWith(WINDOW_ALIAS) ? "1M" : "200k";

/**
 * Effort and context window, one chip that is never hidden (#673): the
 * level, then the window; disabled with its reason where the model has none.
 */
export function EffortChip({
	harness,
	model,
	effort,
	onEffort,
	onModel,
	disabled,
	side = "top",
}: {
	harness: HarnessStatus | undefined;
	model: string;
	effort: string | null;
	onEffort: (id: string) => void;
	onModel: (model: string) => void;
	disabled?: boolean;
	side?: "top" | "bottom";
}) {
	const [open, setOpen] = useState(false);
	const levels = effortLevels(harness);
	const windowed = harness?.id === "claude-code";
	const current =
		levels.find((l) => l.id === effort || l.name === effort) ??
		levels.find((l) => l.default) ??
		levels[0];
	if (!harness || !current) {
		const reason = `${chipModel(harness, model)} has no effort levels; the context window is fixed by the model`;
		return (
			<Hint label={reason} side="top">
				<span className="inline-flex">
					<button
						type="button"
						disabled
						className={CHIP}
						data-testid="effort-chip"
						data-off=""
					>
						{/* A bare "Effort" read as an empty value (#673 w56). */}
						Default
						<Caret />
					</button>
				</span>
			</Hint>
		);
	}
	const win = windowOf(model);
	// The agent's own model has no id to alias, so 1M takes the id the agent serves.
	const base =
		(model.endsWith(WINDOW_ALIAS)
			? model.slice(0, -WINDOW_ALIAS.length)
			: model) ||
		harness.envModel?.model ||
		harness.checked?.servedModel ||
		"";
	const item =
		"flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left text-body font-medium transition-colors duration-(--dur-instant) hover:bg-surface-3 focus-visible:bg-surface-3";
	const tag = (
		<span className="ml-auto text-[11px] leading-4 text-text-2">Default</span>
	);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className={CHIP}
					data-testid="effort-chip"
				>
					<span>{current.name}</span>
					{windowed && <span className="font-normal text-text-3">{win}</span>}
					<Caret />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align="start"
				sideOffset={6}
				className="w-60 rounded-surface p-1"
				data-testid="effort-menu"
				onKeyDown={roveKeys}
				onOpenAutoFocus={focusChosen}
			>
				<p className="px-2.5 pt-2 pb-1 text-meta text-text-3">Effort</p>
				{levels.map((l) => (
					<button
						key={l.id}
						type="button"
						className={cn(item, l.id === current.id && "bg-surface-3")}
						tabIndex={l.id === current.id ? 0 : -1}
						data-rove=""
						data-chosen={l.id === current.id ? "" : undefined}
						onClick={() => {
							setOpen(false);
							if (l.id !== current.id) onEffort(l.id);
						}}
						data-testid="effort-option"
					>
						{l.name}
						{l.default && tag}
					</button>
				))}
				<div className="mx-1.5 my-1 h-px bg-hairline" />
				<p className="px-2.5 pt-2 pb-1 text-meta text-text-3">Context window</p>
				{(["200k", "1M"] as const).map((w) => (
					<button
						key={w}
						type="button"
						disabled={!windowed || (w === "1M" && !base)}
						tabIndex={-1}
						data-rove=""
						className={cn(
							item,
							windowed && w === win && "bg-surface-3",
							(!windowed || (w === "1M" && !base)) &&
								"cursor-default text-text-3 hover:bg-transparent",
						)}
						onClick={() => {
							setOpen(false);
							if (w !== win)
								onModel(w === "1M" ? `${base}${WINDOW_ALIAS}` : base);
						}}
						data-testid="window-option"
					>
						{w}
						{w === "200k" && windowed && tag}
					</button>
				))}
				{!windowed && (
					<p className="px-2.5 pb-2 text-meta text-text-3">
						{harness.label} sets the context window with the model
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** Permission level for this run (#673 w21 ruling 2026-10-10): the four levels, the default first. */
export function AccessChip({
	harness,
	level,
	onLevel,
	disabled,
	side = "top",
	testId = "access-chip",
}: {
	harness: HarnessStatus | undefined;
	level: AccessLevel;
	onLevel: (level: AccessLevel) => void;
	disabled?: boolean;
	side?: "top" | "bottom";
	testId?: string;
}) {
	const { axes } = useAgentChoice();
	const [open, setOpen] = useState(false);
	const fallback = defaultAccessOf(harness, axes).level;
	const rows = [
		fallback.level,
		...ACCESS_LEVELS.filter((l) => l !== fallback.level),
	];
	const text = ACCESS_LEVEL_LABEL[level];
	const locked = levelIcon(levelSandbox(harness, level)) === "lock";
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className={cn(CHIP, "max-w-48")}
					data-testid={testId}
					aria-label={`Permission: ${text}`}
				>
					{locked && <Lock className="size-3.5 shrink-0" aria-hidden />}
					<span className="truncate">{text}</span>
					<Caret />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align="start"
				sideOffset={6}
				className="w-[min(460px,calc(100vw-32px))] rounded-surface p-1"
				data-testid="access-menu"
				onKeyDown={roveKeys}
				onOpenAutoFocus={focusChosen}
			>
				<div role="listbox" aria-label="Permission level">
					{rows.map((l) => {
						const sandbox = harness ? levelSandbox(harness, l) : undefined;
						return (
							<button
								key={l}
								type="button"
								role="option"
								aria-selected={l === level}
								tabIndex={l === level ? 0 : -1}
								data-rove=""
								data-chosen={l === level ? "" : undefined}
								onClick={() => {
									setOpen(false);
									if (l !== level) onLevel(l);
								}}
								className={cn(
									"grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-control px-2.5 py-2 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3 focus-visible:bg-surface-3",
									l === level && "bg-surface-3",
								)}
								data-testid={`access-level-${l}`}
							>
								{levelIcon(sandbox) === "lock" ? (
									<Lock className="size-3.5 text-text-2" aria-hidden />
								) : (
									<span />
								)}
								<span className="truncate text-body font-medium text-text-1">
									{ACCESS_LEVEL_LABEL[l]}
								</span>
								{l === fallback.level ? (
									<span
										className="text-meta text-text-3"
										data-testid="access-default-tag"
									>
										{defaultTag(fallback.from)}
									</span>
								) : (
									<span />
								)}
								<span
									className="col-start-2 col-end-4 text-meta text-text-2"
									data-testid="access-line"
								>
									{ACCESS_LEVEL_LINE[l]}
								</span>
								{harness && (
									<span
										className="col-start-2 col-end-4 text-meta text-text-2"
										data-testid="access-row-line"
									>
										{levelRowLine(harness, l)}
									</span>
								)}
								<span
									className="col-start-2 col-end-4 truncate text-meta text-text-3"
									title={sandbox?.reason}
									data-testid="access-sandbox"
								>
									{sandboxLine(sandbox)}
								</span>
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** Settings' Next run row: the chip on the stored choice; choosing saves at once. */
export function AgentModelPicker({
	side = "bottom",
}: {
	side?: "top" | "bottom";
}) {
	const { effective, model } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	return (
		<ModelChip
			harness={effective}
			model={model}
			side={side}
			className="bg-surface-2"
			onPick={(h, id) =>
				update.mutate({
					harness: h.id as HarnessSetting,
					models: { [h.id]: id || null },
				})
			}
		/>
	);
}
