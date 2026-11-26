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
	customModelsOf,
	type FavouriteModel,
	type HarnessSetting,
	type HarnessStatus,
} from "@prismalens/contracts";
import {
	Gauge,
	Hand,
	type LucideIcon,
	Pencil,
	Plus,
	RefreshCw,
	Ruler,
	Shield,
	Star,
	TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Picker, type PickerOption } from "@/components/kit/Picker";
import {
	effortIcon,
	modeIcon,
	modeIsDanger,
	modeLine,
} from "@/components/kit/picker-icons";
import { agentFacts } from "@/lib/agent-facts";
import {
	useCheckHarness,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { lazyPart } from "@/lib/lazy";
import { cn } from "@/lib/utils";
import { AgentMark, MakerMark } from "./AgentMark";
import { agentModes, chosenMode, levelOfMode, modeName } from "./agent-modes";
import {
	favouritesFirst,
	isAgentDefault,
	isFoldedId,
	makerOf,
	pickerModels,
	providerOf,
	starredOf,
} from "./model-list";

/** Adding an agent loads its dialog's code on demand (#1101 category 12). */
const AddAgentDialog = lazyPart(() =>
	import("@/components/settings/AddAgentDialog").then((m) => m.AddAgentDialog),
);

export {
	agentCurrentModel,
	agentModelLabel,
	chipModel,
	defaultAccessOf,
	defaultModel,
	modelName,
	shortModel,
	unreadyLine,
	unreadyReason,
	useAgentChoice,
} from "./agent-choice";
export { providerOf };

import {
	agentCurrentModel,
	chipModel,
	defaultModel,
	knownChip,
	modelName,
	modelState,
	rememberChip,
	shortModel,
	useAgentChoice,
} from "./agent-choice";

/** The chip every box control shares: ghost, h-8, 13/500, a 14 px caret. */
export const CHIP =
	"inline-flex h-8 min-w-0 shrink-0 items-center gap-1 rounded-control px-2 text-body font-medium whitespace-nowrap text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 data-[state=open]:bg-surface-3 data-[state=open]:text-text-1 disabled:cursor-default disabled:text-text-3 disabled:hover:bg-transparent";

interface ModelRow {
	harness: HarnessStatus;
	model: string;
	name: string;
	warn?: string;
	legacy?: boolean;
	provider?: string;
	favourite?: boolean;
}

const pickId = (h: HarnessStatus, model: string) => `${h.id}::${model}`;

/** One agent's models as its list orders them, with the stored and served ones it may not list. */
function agentRows(
	agent: HarnessStatus,
	prefs: ReturnType<typeof useAgentChoice>,
	chosen: string,
	favourites: readonly FavouriteModel[],
): ModelRow[] {
	const id = agent.id as HarnessId;
	const row = (m: string, extra: Partial<ModelRow> = {}): ModelRow => {
		const entry = agent.models.entries.find((e) => e.id === m);
		return {
			harness: agent,
			model: m,
			name: modelName(agent, m) ?? m,
			provider: providerOf(agent.id, m),
			...(entry?.status === "legacy" ? { legacy: true } : {}),
			// A free tier that trains on what it is sent says so on its row.
			...(entry?.status === "training"
				? { warn: "Trains on your prompts" }
				: {}),
			...extra,
		};
	};
	const custom = customModelsOf(prefs.customModels[id]);
	const listedIds = new Set(agent.models.entries.map((m) => m.id));
	const stored = prefs.models[id];
	// A starred id the agent doesn't list or can't take; unstarring it clears it (#907).
	const unknown =
		stored &&
		!listedIds.has(stored) &&
		!custom.some((m) => m.id === stored) &&
		!isFoldedId(agent, stored)
			? [
					row(stored, {
						warn:
							agent.modelVia === "unsupported"
								? `${agent.label} picks its own model`
								: `Not confirmed for ${agent.label}`,
					}),
				]
			: [];
	if (modelState(agent) !== "list") return unknown;
	const ids = pickerModels(agent, {
		custom,
		order: prefs.modelOrder[id],
		hidden: prefs.hiddenModels[id],
		favourites: starredOf(prefs.harnesses, prefs.models),
		chosen,
	});
	const current = agentCurrentModel(agent);
	const runsNow =
		current?.id && !stored && !ids.includes(current.id)
			? [row(current.id)]
			: [];
	// The person's favourites lead the agent's rows, in a group of their own (#1180).
	const rows = favouritesFirst(ids, favourites, agent.id).map((m) =>
		row(m.id, m.favourite ? { favourite: true } : {}),
	);
	return [...unknown, ...runsNow, ...rows];
}

const STARRED = "starred";
const NO_FAVOURITES: readonly FavouriteModel[] = [];

/**
 * The agent and model picker (#673 w7, restored on the kit): a rail of Starred, each
 * agent that can run and Add agent; beside it the shown tile's models under their
 * providers, a star on each row. It opens on the box's own agent.
 */
export function ModelChip({
	harness,
	model,
	onPick,
	disabled,
	side = "top",
	emptyName,
	known,
}: {
	harness: HarnessStatus | undefined;
	model: string;
	/** Named while the agent list loads: a thread's recorded agent and model, or the default's last name. */
	known?: { agent: string; model?: string | null } | "default";
	onPick: (harness: HarnessStatus, model: string) => void;
	disabled?: boolean;
	/** What the chip reads while no model is picked, such as "Smallest". */
	emptyName?: string;
	side?: "top" | "bottom";
	/** Ignored: the kit picker owns its look. */
	className?: string;
}) {
	const prefs = useAgentChoice();
	const favourites = useHarnessSettings().data?.favourites ?? NO_FAVOURITES;
	const update = useUpdateHarnessSettings();
	const check = useCheckHarness();
	const [adding, setAdding] = useState(false);
	const [tile, setTile] = useState<string>(harness?.id ?? STARRED);
	const { harnesses, models, isLoading } = prefs;
	// The rows rebuild only when what they show changes: every agent's models, with marks,
	// took over 100 ms on a slowed CPU at each data arrival (#1101 cat 1.8).
	const { onList, options, shownId } = useMemo(() => {
		// Only agents that can run, plus the one this box is on, so a choice never vanishes (#907); never an Off one (#1171).
		const onList = harnesses
			.filter((h) => !h.off && (h.runnable || h.id === harness?.id))
			.sort(
				(a, b) => Number(b.id === harness?.id) - Number(a.id === harness?.id),
			);
		const isStarred = (h: HarnessStatus, id: string) =>
			models[h.id as HarnessId] === id;
		const toggleStar = (r: ModelRow) =>
			update.mutate({
				models: {
					[r.harness.id]: isStarred(r.harness, r.model) ? null : r.model,
				},
			});
		const star = (r: ModelRow) => (
			<button
				type="button"
				aria-label={
					isStarred(r.harness, r.model) ? `Unstar ${r.name}` : `Star ${r.name}`
				}
				aria-pressed={isStarred(r.harness, r.model)}
				onPointerDown={(e) => {
					e.preventDefault();
					e.stopPropagation();
					toggleStar(r);
				}}
				onKeyDown={(e) => {
					// cmdk takes Enter for the row it has selected; on a focused star it stars (#1154).
					if (e.key !== "Enter" && e.key !== " ") return;
					e.preventDefault();
					e.stopPropagation();
					toggleStar(r);
				}}
				onClick={(e) => {
					// cmdk selects the row on click; the star must not.
					e.preventDefault();
					e.stopPropagation();
				}}
				className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-text-3 hover:bg-surface-4 hover:text-text-1"
				data-testid="model-star"
			>
				<Star
					className={cn(
						"size-3.5",
						isStarred(r.harness, r.model) && "fill-current text-text-1",
					)}
				/>
			</button>
		);
		// A row in an agent's group shows its maker; a Starred row, which mixes agents, its agent (#1101).
		const option = (
			r: ModelRow,
			group: string,
			starred = false,
		): PickerOption => ({
			id: pickId(r.harness, r.model),
			name: r.name,
			group,
			mark: starred ? (
				<AgentMark id={r.harness.id} className="size-3.5" />
			) : (
				<MakerMark maker={makerOf(r.harness, r.model)} className="size-3.5" />
			),
			keywords: [r.model, r.provider ?? ""],
			...(r.warn ? { warn: true, description: r.warn } : {}),
			...(r.legacy && !r.warn ? { description: "Legacy" } : {}),
			trailing: star(r),
			testId: "model-option",
		});
		const starredRows = starredOf(harnesses, models).flatMap((f) => {
			const h = onList.find((x) => x.id === f.harness);
			return h
				? [
						option(
							{
								harness: h,
								model: f.model,
								name: modelName(h, f.model) ?? f.model,
							},
							"",
							true,
						),
					]
				: [];
		});
		// The box's agent may be off the rail (turned off, uninstalled): the first agent shows.
		const shown =
			tile === STARRED
				? undefined
				: (onList.find((h) => h.id === tile) ?? onList[0]);
		const options: PickerOption[] = !shown
			? starredRows
			: ((h): PickerOption[] => {
					const state = modelState(h);
					if (state === "pending")
						return [
							{
								id: `check::${h.id}`,
								name: check.isPending ? "Checking" : "List its models",
								icon: RefreshCw,
								run: () => check.mutate({ id: h.id as HarnessId }),
								testId: "model-pending",
							},
						];
					if (state === "own")
						return [
							{
								id: pickId(h, ""),
								name: "Its own model",
								mark: <AgentMark id={h.id} className="size-3.5" />,
							},
						];
					const chosen =
						harness?.id === h.id ? model : (models[h.id as HarnessId] ?? "");
					// Under the shown agent, rows sit under who serves them (#673 w7).
					return agentRows(h, prefs, chosen, favourites).map((r) =>
						option(r, r.favourite ? "Favourites" : (r.provider ?? h.label)),
					);
				})(shown);
		return { onList, options, shownId: shown?.id ?? STARRED };
	}, [
		prefs,
		harness,
		model,
		check.isPending,
		check.mutate,
		update.mutate,
		models,
		harnesses.filter,
		harnesses,
		tile,
		favourites,
	]);
	// With none picked, the row ticked is the one the chip names: what the agent runs, else its first (#907).
	const current =
		harness &&
		(model && !isFoldedId(harness, model)
			? model
			: (defaultModel(harness, models[harness.id as HarnessId])?.id ?? model));
	const shown = !model && emptyName ? emptyName : chipModel(harness, model);
	const early = isLoading
		? knownChip(known === "default" ? null : known)
		: null;
	const asDefault = known === "default";
	const agentId = harness?.id;
	useEffect(() => {
		if (!isLoading && agentId && !emptyName)
			rememberChip(agentId, model, shown, asDefault);
	}, [isLoading, agentId, model, shown, emptyName, asDefault]);
	const markId = harness?.id ?? early?.agent;
	// The chip shows who makes the model it names, as its row does; the agent only while none is named.
	const maker =
		harness && current && modelState(harness) !== "own"
			? makerOf(harness, current)
			: null;
	const chipMark = maker ? (
		<MakerMark maker={maker} className="size-3.5" />
	) : markId ? (
		<AgentMark id={markId} className="size-3.5" />
	) : null;
	return (
		<>
			<Picker
				label="Model"
				fact="model"
				options={options}
				onOpenChange={(open) => {
					if (open) setTile(harness?.id ?? STARRED);
				}}
				rail={{
					label: "Agents",
					value: shownId,
					onChange: setTile,
					items: [
						{
							id: STARRED,
							name: "Starred",
							icon: Star,
							testId: "rail-starred",
						},
						...onList.map((h) => ({
							id: h.id,
							name: h.label,
							mark: <AgentMark id={h.id} className="size-5" />,
							testId: `rail-${h.id}`,
						})),
						{
							id: "add-agent",
							name: "Add agent",
							icon: Plus,
							run: () => setAdding(true),
							testId: "rail-add-agent",
						},
					],
				}}
				emptyText={shownId === STARRED ? "No starred models" : "No match"}
				{...(harness && !isLoading && modelState(harness) !== "own"
					? { hint: `via ${harness.label}` }
					: {})}
				value={harness ? pickId(harness, current ?? "") : ""}
				onChange={(id) => {
					const [hid, ...rest] = id.split("::");
					const h = harnesses.find((x) => x.id === hid);
					if (h) onPick(h, rest.join("::"));
				}}
				display={{
					name: isLoading ? (early?.name ?? "…") : shown,
					...(chipMark ? { mark: chipMark } : {}),
				}}
				searchPlaceholder={`Search ${onList.find((h) => h.id === shownId)?.label ?? "starred"} models`}
				short={shortModel}
				disabled={disabled}
				side={side}
				testId="agent-picker"
				listTestId="agent-picker-list"
			/>
			{adding && <AddAgentDialog open onOpenChange={setAdding} />}
		</>
	);
}

/**
 * An agent's effort levels by its own names, its current one marked. A
 * `default` pseudo-level names no level, so it reads "Default" (#1020).
 */
export function effortLevels(
	h: HarnessStatus | undefined,
): { id: string; name: string; default: boolean }[] {
	const named = (l: { id: string; name: string; default: boolean }) =>
		h && isAgentDefault(l) ? { ...l, name: "Default" } : l;
	const listed = h?.checked?.efforts;
	if (listed?.length) return listed.map(named);
	const offered = h?.checked?.effort;
	if (!offered) return [];
	return offered.values.map((v) =>
		named({
			id: v,
			name: v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " "),
			default: v === offered.default,
		}),
	);
}

/**
 * Effort and, on Claude Code, the context window: one kit picker that is
 * never hidden, locked with its reason where the agent has no levels (#673).
 */
export function EffortChip({
	harness,
	model,
	effort,
	onEffort,
	onModel,
	disabled,
	side = "top",
	compact,
}: {
	harness: HarnessStatus | undefined;
	model: string;
	effort: string | null;
	onEffort: (id: string) => void;
	onModel: (model: string) => void;
	disabled?: boolean;
	side?: "top" | "bottom";
	/** Icon only on a phone (the composer's one-row footer). */
	compact?: boolean;
}) {
	const levels = effortLevels(harness);
	const current =
		levels.find((l) => l.id === effort || l.name === effort) ??
		levels.find((l) => l.default) ??
		levels[0];
	if (!harness || !current)
		return (
			<Picker
				label="Effort"
				fact="effort"
				options={[{ id: "fixed", name: "Effort", icon: Gauge }]}
				value="fixed"
				onChange={() => undefined}
				locked={`${harness?.label ?? "This agent"} sets its own effort`}
				side={side}
				compact={compact}
				testId="effort-chip"
			/>
		);
	// An agent with a larger window takes it as a model-id suffix (agent facts' modelWindow).
	const window = agentFacts(harness.id)?.modelWindow;
	const windowed = !!window;
	const large = !!window && model.endsWith(window.alias);
	const win = large ? window.large : (window?.base ?? "");
	// The agent's own model has no id to alias, so the large window takes the id the agent serves.
	const base =
		(large ? model.slice(0, -window.alias.length) : model) ||
		harness.envModel?.model ||
		harness.checked?.servedModel ||
		"";
	const windows = !window
		? []
		: base
			? [window.base, window.large]
			: [window.base];
	const options: PickerOption[] = [
		...levels.map((l) => ({
			id: l.id,
			name: l.name,
			icon: effortIcon(l.id),
			...(windowed ? { group: "Effort" } : {}),
			...(l.default && !isAgentDefault({ id: l.id })
				? { description: `${harness.label}'s pick` }
				: {}),
			testId: "effort-option",
		})),
		...(windowed
			? windows.map((w) => ({
					id: `window:${w}`,
					name: w,
					icon: Ruler,
					group: "Context window",
					testId: "window-option",
				}))
			: []),
	];
	return (
		<Picker
			label="Effort"
			fact="effort"
			options={options}
			value={[current.id, `window:${win}`]}
			onChange={(id) => {
				if (!id.startsWith("window:")) return onEffort(id);
				onModel(
					window && id === `window:${window.large}`
						? `${base}${window.alias}`
						: base,
				);
			}}
			display={{
				name: windowed ? `${current.name} · ${win}` : current.name,
				icon: effortIcon(current.id),
			}}
			disabled={disabled}
			side={side}
			compact={compact}
			testId="effort-chip"
			listTestId="effort-menu"
		/>
	);
}

/** The level-less fallback's icons, where an agent lists no modes. */
const LEVEL_ICON: Record<AccessLevel, LucideIcon> = {
	supervised: Hand,
	"auto-edits": Pencil,
	auto: Shield,
	"full-access": TriangleAlert,
};

/**
 * The permission picker as the agent's own modes (sheet §5): its id, name and
 * description; a mode a level maps to sends that level, any other sends the
 * mode as is. An agent with no modes shows the four levels instead.
 */
export function ModeChip({
	harness,
	level,
	agentMode,
	onPick,
	disabled,
	lockedHint,
	levelsOnly,
	side = "top",
	compact,
	testId = "access-chip",
}: {
	harness: HarnessStatus | undefined;
	level: AccessLevel;
	agentMode?: string | null;
	onPick: (next: {
		accessLevel?: AccessLevel;
		agentMode: string | null;
	}) => void;
	disabled?: boolean;
	/** Shown locked, with this hint saying why: a follow-up keeps the run's mode. */
	lockedHint?: string;
	/** Only modes a level maps to, where the caller stores a level alone (a schedule). */
	levelsOnly?: boolean;
	side?: "top" | "bottom";
	/** Icon only on a phone (the composer's one-row footer). */
	compact?: boolean;
	testId?: string;
}) {
	const modes = agentModes(harness);
	// A level above the agent's own default carries the warn mark (#1101 category 6 item 4).
	const base = ACCESS_LEVELS.indexOf(
		harness?.localDefault?.permission?.level ?? "supervised",
	);
	const above = (l: AccessLevel | null) =>
		!!l && ACCESS_LEVELS.indexOf(l) > base;
	if (!modes) {
		return (
			<Picker
				label="Permission"
				fact="access"
				options={ACCESS_LEVELS.map((l) => ({
					id: `level:${l}`,
					name: ACCESS_LEVEL_LABEL[l],
					description: ACCESS_LEVEL_LINE[l],
					...(above(l) ? { warn: true } : {}),
					icon: LEVEL_ICON[l],
					testId: `access-level-${l}`,
				}))}
				value={`level:${level}`}
				onChange={(id) =>
					onPick({
						accessLevel: id.slice("level:".length) as AccessLevel,
						agentMode: null,
					})
				}
				locked={lockedHint}
				disabled={disabled}
				side={side}
				compact={compact}
				testId={testId}
				listTestId="access-menu"
			/>
		);
	}
	const shown = levelsOnly
		? modes.filter((m) => levelOfMode(harness, m.id))
		: modes;
	return (
		<Picker
			label="Permission"
			fact="access"
			options={shown.map((m) => {
				// A mode several levels run (OpenCode's build) is named for the level in force.
				const name = modeName(harness, m, level);
				const mapped = levelOfMode(harness, m.id, level);
				const own = m.description?.replace(/([^.!?])$/, "$1.");
				const said = [
					own ?? (mapped ? ACCESS_LEVEL_LINE[mapped] : modeLine(m.id)),
					name !== m.name ? `The agent calls it ${m.name}.` : null,
				]
					.filter(Boolean)
					.join(" ");
				return {
					id: m.id,
					name,
					icon: modeIcon(m.id),
					...(said ? { description: said } : {}),
					...(above(mapped) || modeIsDanger(m.id) ? { warn: true } : {}),
					testId: `access-mode-${m.id}`,
				};
			})}
			value={chosenMode(harness, level, agentMode) ?? ""}
			onChange={(id) => {
				const mapped = levelOfMode(harness, id, level);
				onPick(
					mapped ? { accessLevel: mapped, agentMode: null } : { agentMode: id },
				);
			}}
			locked={lockedHint}
			disabled={disabled}
			side={side}
			compact={compact}
			testId={testId}
			listTestId="access-menu"
		/>
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
			known="default"
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
