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
import { Check, ChevronDown, Search, Star } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useMemo,
	useRef,
	useState,
} from "react";
import { Hint } from "@/components/shared/Hint";
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
 * The agent and model the next run starts with (study-v3 §3.5, decision 13,
 * T3 Code's shape): agents as a rail of marks with their names, a Starred
 * tile across agents, a searchable model list with "Agent default" first,
 * favourites, then the agent's models by provider. Choosing saves at once.
 * The same control sits in the box on an incident and in Settings, Agent.
 */
export function AgentModelPicker({
	side = "bottom",
	className,
	defaultOpen = false,
}: {
	side?: "top" | "bottom";
	className?: string;
	defaultOpen?: boolean;
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

	const defaultRow =
		agent && modelState(agent) === "list" && shown !== "starred" && !q.trim();
	// A model stored for an agent that cannot take one blocks its runs (#639).
	const clearRow =
		agent && modelState(agent) !== "list" && models[agent.id as HarnessId];
	const lead = defaultRow || clearRow ? 1 : 0;
	const count = rows.length + lead;
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setCursor((c) => Math.min(count - 1, c + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setCursor((c) => Math.max(0, c - 1));
		} else if (e.key === "Enter") {
			// Enter on a rail tile or button is that control's own click.
			if ((e.target as HTMLElement).closest("button")) return;
			e.preventDefault();
			if (agent && lead && cursor === 0) return pick(agent, "");
			const r = rows[cursor - lead];
			if (r) pick(r.harness, r.model);
		}
	};

	const label = agentModelLabel(effective, model);
	let index = 0;
	const groups: { name: string; rows: Row[] }[] = [];
	for (const r of rows) {
		const last = groups.at(-1);
		if (last?.name === r.group) last.rows.push(r);
		else groups.push({ name: r.group, rows: [r] });
	}

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
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex h-7 min-w-0 items-center gap-1.5 rounded-control bg-surface-3 px-2 text-body font-medium text-text-1 outline-none hover:bg-surface-4 focus-visible:ring-2 focus-visible:ring-accent",
						className,
					)}
					data-testid="agent-picker"
					aria-label={`Agent and model for the next run: ${label.agent}, ${label.model}`}
				>
					{effective && <AgentMark id={effective.id} className="size-3.5" />}
					<span className="truncate" data-testid="model-pill">
						{isLoading
							? "…"
							: effective?.modelVia === "unsupported"
								? effective.label
								: label.model === "agent default"
									? "Agent default"
									: label.model}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				side={side}
				align="start"
				className="w-[28rem] max-w-[calc(100vw-2rem)] p-0"
				data-testid="agent-picker-list"
				onKeyDown={onKeyDown}
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					search.current?.focus();
				}}
			>
				<div className="flex max-h-[26rem] min-h-72">
					<nav
						aria-label="Agents"
						className="flex w-16 shrink-0 flex-col items-stretch gap-0.5 overflow-y-auto border-r border-hairline py-1.5"
					>
						<RailTile
							on={shown === "starred"}
							label="Starred"
							mark={<StarredMark />}
							onClick={() => {
								setTile("starred");
								setCursor(0);
							}}
							testId="rail-starred"
						/>
						{harnesses.map((h) => (
							<RailTile
								key={h.id}
								on={shown === h.id}
								off={!h.installed}
								label={h.label.replace(/ (Code|CLI)$/, "")}
								title={h.installed ? h.label : `${h.label}, not installed`}
								mark={<AgentMark id={h.id} />}
								onClick={() => {
									if (!h.installed) return;
									setTile(h.id);
									setCursor(0);
								}}
								testId={`rail-${h.id}`}
							/>
						))}
					</nav>
					<div className="flex min-w-0 flex-1 flex-col">
						<label className="mx-2 mt-2 flex h-8 items-center gap-2 rounded-control bg-surface-3 px-2.5">
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
							className="min-h-0 flex-1 overflow-y-auto py-1"
						>
							{agent && modelState(agent) === "pending" && (
								<p
									className="px-3 py-2 text-body text-text-2"
									data-testid="model-pending"
								>
									{agent.label} takes its model by its own settings; whether it
									takes one from PrismaLens is pending a check.
								</p>
							)}
							{agent && modelState(agent) === "own" && (
								<p className="px-3 py-2 text-body text-text-2">
									{agent.label} uses its own model.
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
									<legend className="px-3 pt-2.5 pb-1 text-meta text-text-3">
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
								<p className="px-3 py-2 text-body text-text-2">
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
									<p className="px-3 py-2 text-body text-text-2">
										No model matches.
									</p>
								)}
						</div>
						{agent && shown !== "starred" && <AgentControls agent={agent} />}
						<div className="flex items-center gap-2 border-t border-hairline px-3 py-1.5 text-meta text-text-3">
							<span className="min-w-0 flex-1 truncate">
								Auto: the first agent on PATH
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
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** Effort when the agent offers it over ACP, and the access level every agent runs at. */
function AgentControls({ agent }: { agent: HarnessStatus }) {
	const effort = agent.checked?.effort;
	return (
		<div className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-2">
			<AccessChip />
			{effort && (
				<span
					className="inline-flex h-6 items-center gap-1 rounded-control bg-surface-3 px-2 text-meta text-text-1"
					data-testid="effort-chip"
				>
					Effort {effort.default ?? effort.values[0]}
					<span className="text-text-3">
						{effort.default ? `, ${agent.label}'s default` : ""}
					</span>
				</span>
			)}
		</div>
	);
}

/** Read-only, the one level PR 2 offers, with what it means in the tooltip (R4.1 rev). */
export function AccessChip() {
	return (
		<Hint label={`${READ_ONLY_LINE} ${BOUNDARY_NOTE}`} side="top">
			<button
				type="button"
				className="inline-flex h-6 items-center rounded-control px-1.5 text-meta text-text-2 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="access-chip"
			>
				Read-only
			</button>
		</Hint>
	);
}

function RailTile({
	on,
	off,
	label,
	title,
	mark,
	onClick,
	testId,
}: {
	on: boolean;
	off?: boolean;
	label: string;
	title?: string;
	mark: ReactNode;
	onClick: () => void;
	testId: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={on}
			aria-disabled={off}
			title={title ?? label}
			className={cn(
				"relative mx-1 flex flex-col items-center gap-1 rounded-control px-0.5 pt-1.5 pb-1 text-[10px] leading-3 text-text-2 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent",
				on &&
					"bg-surface-3 font-medium text-text-1 before:absolute before:top-2 before:bottom-2 before:-left-1 before:w-0.5 before:rounded-full before:bg-accent",
				off && "cursor-not-allowed opacity-40 hover:bg-transparent",
			)}
			data-testid={testId}
			data-off={off ? "" : undefined}
		>
			{mark}
			<span className="max-w-full truncate">{label}</span>
		</button>
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
				"group flex cursor-pointer items-center gap-2 px-3 py-1.5",
				(active || chosen) && "bg-surface-3",
			)}
			data-testid={testId}
			data-model={name}
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-body text-text-1">{name}</span>
				{training ? (
					<span
						className="block text-meta text-warn"
						data-testid="model-training"
					>
						trains on your prompts
					</span>
				) : (
					sub && (
						<span className="block truncate text-meta text-text-3">{sub}</span>
					)
				)}
			</span>
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
						"shrink-0 rounded-control p-1 outline-none hover:bg-surface-4 focus-visible:ring-2 focus-visible:ring-accent",
						!starred && "opacity-40 group-hover:opacity-100",
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
		</div>
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
				"inline-flex h-7 min-w-0 items-center gap-1.5 px-2 text-body text-text-2",
				className,
			)}
			data-testid="agent-chip"
		>
			<span className="truncate">{agent}</span>
			{model && <span className="truncate text-text-3">{model}</span>}
		</span>
	);
}

const CHIP =
	"inline-flex h-7 min-w-0 items-center gap-1 rounded-control px-2 text-meta text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3 data-[state=open]:text-text-1";

/**
 * What the next run may touch (r4 R4.1 rev): the four levels with their one
 * line each; the write levels stay greyed until Settings, Agent allows them.
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
			<Hint label={`${ACCESS_LINE[value]} ${ACCESS_BOUNDARY_NOTE}`} side="top">
				<PopoverTrigger asChild>
					<button
						type="button"
						className={CHIP}
						data-testid="access-chip"
						aria-label={`Access: ${ACCESS_LABEL[value]}`}
					>
						<span className="truncate">{ACCESS_LABEL[value]}</span>
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
				<p className="px-2.5 pt-1.5 pb-1 text-meta text-text-3">Access level</p>
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
									"flex w-full flex-col items-start gap-0.5 rounded-control px-2.5 py-2 text-left outline-none focus-visible:bg-surface-3 enabled:hover:bg-surface-3",
									level === value && "bg-surface-3",
									!allowed && "cursor-not-allowed opacity-50",
								)}
								data-testid={`access-level-${level}`}
							>
								<span className="flex w-full items-center gap-2 text-body text-text-1">
									{ACCESS_LABEL[level]}
									{level === value && (
										<Check className="ml-auto size-3.5 text-accent" />
									)}
								</span>
								<span
									className="text-meta text-text-3"
									data-testid="access-line"
								>
									{ACCESS_LINE[level]}
								</span>
								{!allowed && (
									<span className="text-meta text-text-2">
										Allow in Settings, Agent
									</span>
								)}
							</button>
						);
					})}
				</div>
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
				<p className="px-2.5 pt-1.5 pb-1 text-meta text-text-3">Reasoning</p>
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
							"flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-body text-text-1 outline-none hover:bg-surface-3 focus-visible:bg-surface-3",
							v === value && "bg-surface-3",
						)}
						data-testid="effort-option"
					>
						{word(v)}
						{v === offered.default && (
							<span className="ml-auto text-meta text-text-3">
								{effective.label} default
							</span>
						)}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
