// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	HARNESS_AUTO_ORDER,
	type HarnessId,
	PERMISSION_MODES,
	type PermissionMode,
} from "@prismalens/config/harness";
import {
	ACCESS_BOUNDARY_NOTE,
	ACCESS_LABEL,
	ACCESS_LINE,
	accessAllowed,
	type FavouriteModel,
	type HarnessSetting,
	type HarnessStatus,
} from "@prismalens/contracts";
import { Check, ChevronDown, Lock, Search, Star } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Hint } from "@/components/shared/Hint";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { AgentMark, StarredMark } from "./AgentMark";

/** The Read-only level's words (r4 R4.1 rev), from the contracts the gate's tests read. */
export const READ_ONLY_LINE = ACCESS_LINE["read-only"];
export const BOUNDARY_NOTE = ACCESS_BOUNDARY_NOTE;

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
		models: settingsQuery.data?.models ?? {},
		favourites: settingsQuery.data?.favourites ?? [],
		efforts: settingsQuery.data?.efforts ?? {},
		allowWriteLevels: settingsQuery.data?.allowWriteLevels === true,
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
			modelName(
				effective,
				model ||
					effective.envModel?.model ||
					effective.checked?.servedModel ||
					null,
			) ?? "agent default",
	};
}

/**
 * An agent with nothing to list (no catalogue entry, no check yet) is
 * "pending a check" (r4 R4.1 rev); a run still refuses a model it will not take.
 */
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
};
const VENDOR: Record<string, string> = {
	"claude-code": "Anthropic",
	codex: "OpenAI",
	gemini: "Google",
};

/** The group a model id lists under: its provider prefix, else the agent's own vendor. */
export function providerOf(harnessId: string, modelId: string): string {
	const slash = modelId.indexOf("/");
	if (slash > 0) {
		const prefix = modelId.slice(0, slash);
		return (
			PROVIDERS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1)
		);
	}
	return VENDOR[harnessId] ?? "Models";
}

interface Row {
	key: string;
	harness: HarnessStatus;
	model: string;
	name: string;
	sub?: string;
	training?: boolean;
	group: string;
}

const isStarred = (f: FavouriteModel[], harness: string, model: string) =>
	f.some((x) => x.harness === harness && x.model === model);

/**
 * The agent and model the next run starts with (look ruling §2, decision 13,
 * T3 Code's shape): a 44 px rail of agent marks as a vertical tablist, a
 * Starred tile across agents, and the chosen agent's panel: its name, a
 * searchable model list with "Agent default" first, favourites, then models
 * by provider. Fixed at 440 × 360 so switching agents never moves it.
 * Choosing saves at once. The same control sits in the box and in Settings.
 */
export function AgentModelPicker({
	side = "bottom",
	className,
	defaultOpen = false,
	anchor,
}: {
	side?: "top" | "bottom";
	className?: string;
	defaultOpen?: boolean;
	/** The box the panel opens 8 px above, rather than the chip. */
	anchor?: RefObject<HTMLElement | null>;
}) {
	const {
		harnesses,
		setting,
		effective,
		model,
		models,
		favourites,
		isLoading,
	} = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const [open, setOpen] = useState(defaultOpen);
	const [tile, setTile] = useState<string | null>(null);
	const [q, setQ] = useState("");
	const [cursor, setCursor] = useState(0);
	const search = useRef<HTMLInputElement>(null);
	const rail = useRef<HTMLDivElement>(null);
	const coarse = useMediaQuery("(pointer: coarse)");
	const ids = useId();
	const shown = tile ?? effective?.id ?? "starred";
	const agent = harnesses.find((h) => h.id === shown);

	const autoHarness = useMemo(() => {
		const autoId = HARNESS_AUTO_ORDER.find(
			(id) => harnesses.find((h) => h.id === id)?.installed,
		);
		return autoId ? harnesses.find((h) => h.id === autoId) : undefined;
	}, [harnesses]);

	const rows: Row[] = useMemo(() => {
		const byId = new Map(harnesses.map((h) => [h.id, h]));
		const entry = (h: HarnessStatus, id: string, group: string): Row => {
			const m = h.models.entries.find((e) => e.id === id);
			return {
				key: `${group}:${h.id}:${id}`,
				harness: h,
				model: id,
				name: m?.name ?? id,
				training: m?.status === "training",
				sub:
					m?.status === "legacy"
						? "legacy"
						: group === "Starred" && shown === "starred"
							? h.label
							: undefined,
				group,
			};
		};
		const needle = q.trim().toLowerCase();
		const keep = (r: Row) =>
			!needle ||
			r.name.toLowerCase().includes(needle) ||
			r.model.toLowerCase().includes(needle);
		if (shown === "starred") {
			return favourites
				.flatMap((f) => {
					const h = byId.get(f.harness);
					return h?.installed ? [entry(h, f.model, "Starred")] : [];
				})
				.filter(keep);
		}
		if (!agent || modelState(agent) !== "list") return [];
		const starred = favourites
			.filter((f) => f.harness === agent.id)
			.map((f) => entry(agent, f.model, "Starred"));
		const listed = agent.models.entries.map((m) =>
			entry(agent, m.id, providerOf(agent.id, m.id)),
		);
		// A stored id the agent no longer lists stays choosable, and says so (#639).
		const stored = models[agent.id as HarnessId];
		const unknown =
			stored && !agent.models.entries.some((m) => m.id === stored)
				? [
						{
							...entry(agent, stored, providerOf(agent.id, stored)),
							sub: "not in the agent's list",
						},
					]
				: [];
		return [...starred, ...unknown, ...listed].filter(keep);
	}, [harnesses, favourites, shown, agent, q, models]);

	const chosen = (h: HarnessStatus, id: string) =>
		(setting === h.id || (setting === "auto" && effective?.id === h.id)) &&
		(models[h.id as HarnessId] ?? "") === id;

	const pick = (h: HarnessStatus, id: string) => {
		update.mutate({
			harness: h.id as HarnessSetting,
			models: { [h.id]: id || null },
		});
		setOpen(false);
	};
	const star = (h: HarnessStatus, id: string) => {
		const on = isStarred(favourites, h.id, id);
		update.mutate({
			favourites: on
				? favourites.filter((f) => !(f.harness === h.id && f.model === id))
				: [...favourites, { harness: h.id as HarnessId, model: id }],
		});
	};
	const show = (id: string) => {
		setTile(id);
		setCursor(0);
	};

	const defaultRow =
		agent && modelState(agent) === "list" && shown !== "starred" && !q.trim();
	// A model stored for an agent that cannot take one blocks its runs (#639).
	const clearRow =
		agent && modelState(agent) !== "list" && models[agent.id as HarnessId];
	const lead = defaultRow || clearRow ? 1 : 0;
	const count = rows.length + lead;
	const onListKeys = (e: KeyboardEvent<HTMLDivElement>) => {
		if ((e.target as HTMLElement).closest('[role="tablist"]')) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setCursor((c) => Math.min(count - 1, c + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setCursor((c) => Math.max(0, c - 1));
		} else if (e.key === "Enter") {
			// Enter on a button is that control's own click.
			if ((e.target as HTMLElement).closest("button")) return;
			e.preventDefault();
			if (agent && lead && cursor === 0) return pick(agent, "");
			const r = rows[cursor - lead];
			if (r) pick(r.harness, r.model);
		}
	};

	// The rail is one tab stop: Up and Down move along it and show that agent, Right goes to the search.
	const tiles = [
		"starred",
		...harnesses.filter((h) => h.installed).map((h) => h.id),
	];
	const onRailKeys = (e: KeyboardEvent<HTMLDivElement>) => {
		// The shown agent may be off the rail (stored, then uninstalled): Down takes the first, Up the last.
		const found = tiles.indexOf(shown);
		const at = found === -1 ? (e.key === "ArrowUp" ? 0 : -1) : found;
		const go = (i: number) => {
			e.preventDefault();
			const next = tiles[(i + tiles.length) % tiles.length];
			if (!next) return;
			show(next);
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

	const label = agentModelLabel(effective, model);
	const heading =
		shown === "starred" ? "Starred" : (agent?.label ?? "No agent");
	let index = 0;
	const groups: { name: string; rows: Row[] }[] = [];
	for (const r of rows) {
		const last = groups.at(-1);
		if (last?.name === r.group) last.rows.push(r);
		else groups.push({ name: r.group, rows: [r] });
	}
	const tabId = (id: string) => `${ids}-tab-${id}`;

	return (
		<Popover
			open={open}
			onOpenChange={(o) => {
				setOpen(o);
				if (o) {
					setTile(null);
					setQ("");
					setCursor(0);
				}
			}}
		>
			{anchor && (
				<PopoverAnchor virtualRef={anchor as RefObject<HTMLElement>} />
			)}
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(AGENT_CHIP, "hover:bg-surface-4", className)}
					data-testid="agent-picker"
					aria-label={`Agent and model for the next run: ${label.agent}, ${label.model}`}
				>
					{effective && <AgentMark id={effective.id} />}
					<span className="truncate" data-testid="model-pill">
						{isLoading
							? "…"
							: effective?.modelVia === "unsupported"
								? effective.label
								: label.model === "agent default"
									? "Agent default"
									: label.model}
					</span>
					<ChevronDown className="size-3 shrink-0 text-text-3" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align="start"
				sideOffset={8}
				className="grid h-[360px] w-[440px] max-w-[calc(100vw-2rem)] grid-cols-[44px_minmax(0,1fr)] overflow-hidden p-0"
				data-testid="agent-picker-list"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					// A phone's keyboard would cover the list it is meant to filter.
					if (!coarse) search.current?.focus();
				}}
			>
				<div
					ref={rail}
					role="tablist"
					aria-orientation="vertical"
					aria-label="Agents"
					className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto bg-surface-1 py-1.5 [scrollbar-width:none]"
					onKeyDown={onRailKeys}
					data-testid="picker-rail"
				>
					<RailTile
						id={tabId("starred")}
						panel={`${ids}-panel`}
						tile="starred"
						on={shown === "starred"}
						label="Starred"
						mark={<StarredMark className="size-[18px]" />}
						onClick={() => show("starred")}
						testId="rail-starred"
					/>
					{harnesses.map((h) => (
						<RailTile
							key={h.id}
							id={tabId(h.id)}
							panel={`${ids}-panel`}
							tile={h.id}
							on={shown === h.id}
							off={!h.installed}
							label={h.installed ? h.label : `${h.label}, not installed`}
							mark={<AgentMark id={h.id} className="size-5" />}
							onClick={() => {
								if (h.installed) show(h.id);
							}}
							testId={`rail-${h.id}`}
						/>
					))}
				</div>
				<div
					role="tabpanel"
					id={`${ids}-panel`}
					aria-labelledby={tabId(shown)}
					className="flex min-h-0 min-w-0 flex-col"
					onKeyDown={onListKeys}
				>
					<label className="mx-2 mt-2 mb-1 flex h-[30px] shrink-0 items-center gap-2 rounded-control bg-surface-3 px-2.5">
						<Search className="size-3.5 shrink-0 text-text-3" />
						<input
							ref={search}
							value={q}
							onChange={(e) => {
								setQ(e.target.value);
								setCursor(0);
							}}
							placeholder="Search models"
							aria-label="Search models"
							className="h-7 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-text-3"
							data-testid="picker-search"
						/>
					</label>
					<div
						role="listbox"
						aria-label="Models"
						className="min-h-0 flex-1 overflow-y-auto pb-1 [mask-image:linear-gradient(to_bottom,#000_calc(100%-16px),transparent)] [scrollbar-width:thin]"
					>
						<p
							className="truncate px-3 pt-1.5 pb-0.5 text-body font-medium text-text-1"
							data-testid="picker-agent-name"
						>
							{heading}
						</p>
						{agent && modelState(agent) === "pending" && (
							<p
								className="px-3 py-1.5 text-body text-text-2"
								data-testid="model-pending"
							>
								Takes its model from its own settings until a check shows it
								takes one from PrismaLens.
							</p>
						)}
						{agent && modelState(agent) === "own" && (
							<p className="px-3 py-1.5 text-body text-text-2">
								Uses its own model.
							</p>
						)}
						{agent && clearRow && (
							<ModelRow
								active={cursor === index++}
								chosen={false}
								name={`Clear ${models[agent.id as HarnessId]}`}
								sub={`${agent.label} picks its own model`}
								onPick={() => pick(agent, "")}
								testId="model-clear"
							/>
						)}
						{defaultRow && agent && (
							<ModelRow
								active={cursor === index++}
								chosen={chosen(agent, "")}
								name="Agent default"
								sub={
									agent.checked?.servedModel
										? `${modelName(agent, agent.checked.servedModel)}, what ${agent.label} picks`
										: `what ${agent.label} picks`
								}
								onPick={() => pick(agent, "")}
								testId="model-default"
							/>
						)}
						{groups.map((g) => (
							<fieldset key={g.name} aria-label={g.name}>
								<legend className="px-3 pt-2 pb-0.5 text-meta text-text-3">
									{g.name}
								</legend>
								{g.rows.map((r) => (
									<ModelRow
										key={r.key}
										active={cursor === index++}
										chosen={chosen(r.harness, r.model)}
										name={r.name}
										sub={r.sub}
										training={r.training}
										starred={isStarred(favourites, r.harness.id, r.model)}
										onStar={() => star(r.harness, r.model)}
										onPick={() => pick(r.harness, r.model)}
										testId="model-option"
									/>
								))}
							</fieldset>
						))}
						{shown === "starred" && rows.length === 0 && (
							<p className="px-3 py-1.5 text-body text-text-2">
								{q.trim()
									? "No starred model matches."
									: "Star a model under any agent and it lists here."}
							</p>
						)}
						{shown !== "starred" &&
							agent &&
							modelState(agent) === "list" &&
							rows.length === 0 &&
							q.trim() && (
								<p className="px-3 py-1.5 text-body text-text-2">
									No model matches.
								</p>
							)}
					</div>
					{agent && shown !== "starred" && <AgentControls agent={agent} />}
					<div className="flex shrink-0 items-center gap-2 bg-surface-1 px-3 py-1.5 text-meta text-text-3">
						<span className="min-w-0 flex-1 truncate">
							Auto picks the first agent on PATH
							{autoHarness ? `, now ${autoHarness.label}` : ""}
						</span>
						{setting !== "auto" && (
							<button
								type="button"
								className="shrink-0 text-accent hover:underline"
								onClick={() => {
									update.mutate({ harness: "auto" });
									setOpen(false);
								}}
								data-testid="agent-option-auto"
							>
								Use Auto
							</button>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** Effort when the agent offers it over ACP, and the access level every agent runs at. */
function AgentControls({ agent }: { agent: HarnessStatus }) {
	const effort = agent.checked?.effort;
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-1.5 bg-surface-1 px-2 py-1.5">
			<AccessChip />
			{effort && (
				<span
					className="inline-flex h-6 items-center gap-1 rounded-control bg-surface-3 px-2 text-meta font-medium text-text-1"
					data-testid="effort-chip"
				>
					Effort {effort.default ?? effort.values[0]}
					<span className="font-normal text-text-3">
						{effort.default ? `, ${agent.label}'s default` : ""}
					</span>
				</span>
			)}
		</div>
	);
}

/** Read-only, the one level every agent starts at, with what it means in the hint (R4.1 rev). */
export function AccessChip() {
	return (
		<Hint label={ACCESS_SHORT["read-only"]} meta={GUARDRAIL} side="top">
			<button
				type="button"
				className="inline-flex h-6 items-center rounded-control bg-surface-3 px-2 text-meta font-medium text-text-1 hover:bg-surface-4"
				data-testid="access-chip"
			>
				Read-only
			</button>
		</Hint>
	);
}

function RailTile({
	id,
	panel,
	tile,
	on,
	off,
	label,
	mark,
	onClick,
	testId,
}: {
	id: string;
	panel: string;
	tile: string;
	on: boolean;
	off?: boolean;
	label: string;
	mark: ReactNode;
	onClick: () => void;
	testId: string;
}) {
	return (
		<Hint label={label} side="left">
			<button
				type="button"
				role="tab"
				id={id}
				aria-selected={on}
				aria-controls={panel}
				aria-disabled={off}
				aria-label={label}
				tabIndex={on ? 0 : -1}
				onClick={onClick}
				className={cn(
					"relative inline-flex size-8 shrink-0 items-center justify-center rounded-surface text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3",
					on &&
						"bg-surface-3 text-text-1 before:absolute before:top-2 before:bottom-2 before:-left-1.5 before:w-0.5 before:rounded-full before:bg-accent",
					off && "cursor-not-allowed opacity-40 hover:bg-transparent",
				)}
				data-testid={testId}
				data-tile={tile}
				data-off={off ? "" : undefined}
			>
				{mark}
			</button>
		</Hint>
	);
}

function ModelRow({
	active,
	chosen,
	name,
	sub,
	training,
	starred,
	onStar,
	onPick,
	testId,
}: {
	active: boolean;
	chosen: boolean;
	name: string;
	sub?: string;
	training?: boolean;
	starred?: boolean;
	onStar?: () => void;
	onPick: () => void;
	testId: string;
}) {
	const meta = training || !!sub;
	return (
		<div
			role="option"
			tabIndex={-1}
			aria-selected={chosen}
			onMouseDown={(e) => {
				e.preventDefault();
				onPick();
			}}
			className={cn(
				"group flex cursor-pointer items-center gap-2 pr-1.5 pl-3 transition-colors duration-(--dur-instant) hover:bg-surface-3",
				meta ? "h-11" : "h-8",
				(active || chosen) && "bg-surface-3",
			)}
			data-testid={testId}
			data-model={name}
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-body text-text-1">{name}</span>
				{training ? (
					<span
						className="block truncate text-meta text-warn"
						data-testid="model-training"
					>
						trains on your prompts
					</span>
				) : (
					sub && (
						<span className="block truncate text-meta text-text-2">{sub}</span>
					)
				)}
			</span>
			<span className="inline-flex size-7 shrink-0 items-center justify-center">
				{onStar && (
					<button
						type="button"
						aria-label={starred ? `Unstar ${name}` : `Star ${name}`}
						aria-pressed={starred}
						onMouseDown={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onStar();
						}}
						onKeyDown={(e) => {
							if (e.key !== "Enter" && e.key !== " ") return;
							e.preventDefault();
							e.stopPropagation();
							onStar();
						}}
						className={cn(
							"inline-flex size-7 items-center justify-center rounded-control hover:bg-surface-4",
							!starred && "opacity-50 group-hover:opacity-100",
						)}
						data-testid="model-star"
					>
						<Star
							className={cn(
								"size-3.5",
								starred ? "fill-warn text-warn" : "text-text-3",
							)}
						/>
					</button>
				)}
			</span>
			<span className="inline-flex w-3.5 shrink-0 justify-center">
				{chosen && <Check className="size-3.5 text-accent" aria-hidden />}
			</span>
		</div>
	);
}

/** The one shape the box's agent takes in every state: mark, model, chevron when it opens. */
const AGENT_CHIP =
	"inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-control bg-surface-3 pr-2 pl-1 text-meta font-medium whitespace-nowrap text-text-1 transition-colors duration-(--dur-instant)";

/** The agent and model a live run is fixed on: the same chip, with nothing to open (#743 §6). */
export function AgentModelChip({
	agent,
	harness,
	model,
	className,
}: {
	agent: string;
	/** The agent's id, for its mark. */
	harness?: string | null;
	model?: string | null;
	className?: string;
}) {
	const shown =
		!model || model === "agent default" || model === "its own model"
			? agent
			: model;
	return (
		<Hint
			label={`${agent}, ${model ?? "agent default"}`}
			meta="Fixed for this run"
			side="top"
		>
			<span className={cn(AGENT_CHIP, className)} data-testid="agent-chip">
				{harness && <AgentMark id={harness} />}
				<span className="truncate">{shown}</span>
				<span className="sr-only">, fixed for this run</span>
			</span>
		</Hint>
	);
}

const CHIP =
	"inline-flex h-6 min-w-0 items-center gap-1 rounded-control px-2 text-meta font-medium text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 data-[state=open]:bg-surface-3 data-[state=open]:text-text-1";

/**
 * Each level in a word and one short line (look ruling L57); the full rule
 * lives in Settings, Agent. ACCESS_LINE stays the record the gate's tests read.
 */
const ACCESS_SHORT: Record<PermissionMode, string> = {
	"read-only": "Reads the code and the brief's telemetry",
	"read-only-tools": "Adds GET anywhere and your CLIs' read commands",
	"workspace-write": "Edits the run's copy and runs its tests",
	"full-access": "Anything on this machine, every request logged",
};
const GUARDRAIL = "A guardrail for an honest agent, not a sandbox.";

/**
 * What the next run may touch (r4 R4.1 rev): the four levels, a word and a
 * line each; the write levels stay greyed until Settings, Agent allows them.
 * On a phone the chip is a lock; the level is in its label and the menu.
 */
export function AccessMenu({
	value,
	onChange,
	side = "top",
}: {
	value: PermissionMode;
	onChange: (level: PermissionMode) => void;
	side?: "top" | "bottom";
}) {
	const { allowWriteLevels } = useAgentChoice();
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Hint label={ACCESS_SHORT[value]} meta={GUARDRAIL} side="top">
				<PopoverTrigger asChild>
					<button
						type="button"
						className={CHIP}
						data-testid="access-chip"
						aria-label={`Access: ${ACCESS_LABEL[value]}`}
					>
						<Lock className="size-3.5 shrink-0 sm:hidden" aria-hidden />
						<span className="truncate max-sm:hidden">
							{ACCESS_LABEL[value]}
						</span>
						<ChevronDown className="size-3 shrink-0 text-text-3" />
					</button>
				</PopoverTrigger>
			</Hint>
			<PopoverContent
				side={side}
				align="start"
				className="w-80 max-w-[calc(100vw-2rem)] p-1"
				data-testid="access-menu"
			>
				<div role="listbox" aria-label="Access level">
					{PERMISSION_MODES.map((level) => {
						const allowed = accessAllowed(level, allowWriteLevels);
						return (
							<button
								key={level}
								type="button"
								role="option"
								aria-selected={level === value}
								aria-disabled={!allowed}
								disabled={!allowed}
								onClick={() => {
									onChange(level);
									setOpen(false);
								}}
								className={cn(
									"flex h-11 w-full items-center gap-2 rounded-control px-2.5 text-left transition-colors duration-(--dur-instant) focus-visible:bg-surface-3 enabled:hover:bg-surface-3",
									level === value && "bg-surface-3",
									!allowed && "cursor-not-allowed opacity-50",
								)}
								data-testid={`access-level-${level}`}
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-body text-text-1">
										{ACCESS_LABEL[level]}
									</span>
									<span
										className="block truncate text-meta text-text-2"
										data-testid="access-line"
									>
										{allowed
											? ACCESS_SHORT[level]
											: "Allow write levels in Settings, Agent"}
									</span>
								</span>
								<span className="inline-flex w-3.5 shrink-0 justify-center">
									{level === value && (
										<Check className="size-3.5 text-accent" aria-hidden />
									)}
								</span>
							</button>
						);
					})}
				</div>
				<p className="px-2.5 pt-1.5 pb-1 text-meta text-text-3">{GUARDRAIL}</p>
			</PopoverContent>
		</Popover>
	);
}

const word = (v: string) =>
	v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");

/**
 * Effort, only when the agent offers a `thought_level` option over ACP (R4.2):
 * the agent's own values, its default marked. Saved per agent, like the model.
 */
export function EffortMenu({ side = "top" }: { side?: "top" | "bottom" }) {
	const { effective, efforts } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const [open, setOpen] = useState(false);
	const offered = effective?.checked?.effort;
	if (!effective || !offered) return null;
	const id = effective.id as HarnessId;
	const value = efforts[id] ?? offered.default ?? offered.values[0] ?? "";
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button type="button" className={CHIP} data-testid="effort-chip">
					<span className="truncate">{word(value)} effort</span>
					<ChevronDown className="size-3 shrink-0 text-text-3" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align="start"
				className="w-56 p-1"
				data-testid="effort-menu"
			>
				{offered.values.map((v) => (
					<button
						key={v}
						type="button"
						onClick={() => {
							update.mutate({
								efforts: { [id]: v === offered.default ? null : v },
							});
							setOpen(false);
						}}
						className={cn(
							"flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left text-body text-text-1 transition-colors duration-(--dur-instant) hover:bg-surface-3 focus-visible:bg-surface-3",
							v === value && "bg-surface-3",
						)}
						data-testid="effort-option"
					>
						{word(v)}
						{v === offered.default && (
							<span className="ml-auto text-meta text-text-2">
								{effective.label} default
							</span>
						)}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
