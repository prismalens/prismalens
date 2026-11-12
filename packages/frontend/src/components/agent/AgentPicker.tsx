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
import { useState } from "react";
import { Picker, type PickerOption } from "@/components/kit/Picker";
import { effortIcon, modeIcon } from "@/components/kit/picker-icons";
import { AddAgentDialog } from "@/components/settings/AddAgentDialog";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { failureLine, notSignedIn } from "@/lib/failure-words";
import { cn } from "@/lib/utils";
import { AgentMark } from "./AgentMark";
import { agentModes, chosenMode, levelOfMode } from "./agent-modes";
import {
	isAgentDefault,
	isFoldedId,
	pickerModels,
	providerOf,
	starredOf,
} from "./model-list";

export { providerOf };

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
		efforts: settingsQuery.data?.efforts ?? {},
		axes: {
			accessLevels: settingsQuery.data?.accessLevels ?? {},
		},
		customModels: settingsQuery.data?.customModels ?? {},
		hiddenModels: settingsQuery.data?.hiddenModels ?? {},
		modelOrder: settingsQuery.data?.modelOrder ?? {},
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
	if (!id || isFoldedId(harness, id)) return null;
	const entries = (harness?.models.entries ?? []).filter(
		(m) => !isAgentDefault(m),
	);
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

export interface NamedModel {
	/** Null when the agent named a model its list doesn't hold. */
	id: string | null;
	name: string;
}

/**
 * The model the agent runs when a run sends none: what the env or its check
 * reports, a `default` entry resolved through its description, as Claude
 * Code's "Default (recommended)" names the model behind it (#907).
 */
export function agentCurrentModel(h: HarnessStatus): NamedModel | null {
	const raw = h.envModel?.model || h.checked?.servedModel || null;
	if (!raw) return null;
	if (!isFoldedId(h, raw)) return { id: raw, name: modelName(h, raw) ?? raw };
	const said = h.models.entries.find((e) => e.id === raw)?.description;
	const name = said ? modelName(h, said) : null;
	if (!name) return null;
	const listed = h.models.entries.find(
		(e) => !isAgentDefault(e) && modelName(h, e.id) === name,
	);
	return { id: listed?.id ?? null, name };
}

/**
 * PrismaLens's model for `h` by its real name, never the word Default: the
 * starred one, else what the agent runs, else its list's first (#907).
 */
export function defaultModel(
	h: HarnessStatus,
	starred: string | null | undefined,
): NamedModel | null {
	if (starred && !isFoldedId(h, starred))
		return { id: starred, name: modelName(h, starred) ?? starred };
	const current = agentCurrentModel(h);
	if (current) return current;
	const first = h.models.entries.find((e) => !isAgentDefault(e));
	return first
		? { id: first.id, name: modelName(h, first.id) ?? first.id }
		: null;
}

/** The agent and model the next run starts with, each named once. */
export function agentModelLabel(
	effective: HarnessStatus | undefined,
	model: string,
): { agent: string; model: string } {
	if (!effective) return { agent: "No agent", model: "" };
	if (effective.modelVia === "unsupported") {
		return { agent: effective.label, model: "its default model" };
	}
	return {
		agent: effective.label,
		model: defaultModel(effective, model)?.name ?? "its default model",
	};
}

/** The chip's words for a model: always a model's real name (#673 w7, #907). */
export function chipModel(h: HarnessStatus | undefined, model: string): string {
	if (!h) return "No agent";
	if (h.modelVia === "unsupported") return h.label;
	return defaultModel(h, model)?.name ?? h.label;
}

/** Why an installed agent cannot take a run, in the gate's words; null when it can. */
export function unreadyReason(h: HarnessStatus): string | null {
	if (!h.installed || !h.checked || h.checked.outcome === "answers-acp")
		return null;
	// The same words a run that fails on sign-in shows (#831 w7-3).
	if (h.checked.outcome === "sign-in-needed")
		return failureLine(notSignedIn(h.label));
	return `${h.label}: ${h.checked.detail}`;
}

/** The run gate's line: the reason, then where to check it, one full stop each (#673 w9-1). */
export function unreadyLine(h: HarnessStatus): string | null {
	const why = unreadyReason(h)?.replace(/[.\s]+$/, "");
	return why ? `${why}. Check it in Settings, Agent.` : null;
}

function modelState(h: HarnessStatus): "list" | "pending" | "own" {
	if (h.modelVia === "unsupported")
		return h.id === "deepagents" ? "own" : "pending";
	return h.checked || h.models.entries.length > 0 ? "list" : "pending";
}

/** A provider's mark where an agent mark is the same company's. */
const PROVIDER_MARK: Record<string, string> = {
	Anthropic: "claude-code",
	Google: "gemini",
	"OpenCode Zen": "opencode",
};

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
}

const pickId = (h: HarnessStatus, model: string) => `${h.id}::${model}`;

/** One agent's models as its list orders them, with the stored and served ones it may not list. */
function agentRows(
	agent: HarnessStatus,
	prefs: ReturnType<typeof useAgentChoice>,
	chosen: string,
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
	const custom = prefs.customModels[id] ?? [];
	const listedIds = new Set(agent.models.entries.map((m) => m.id));
	const stored = prefs.models[id];
	// A starred id the agent doesn't list or can't take; unstarring it clears it (#907).
	const unknown =
		stored &&
		!listedIds.has(stored) &&
		!custom.includes(stored) &&
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
	return [...unknown, ...runsNow, ...ids.map((m) => row(m))];
}

/**
 * The agent and model picker (sheet §5): the kit picker, one group per agent
 * that can run with starred models first, a star on each row, and Add agent.
 */
export function ModelChip({
	harness,
	model,
	onPick,
	disabled,
	side = "top",
	emptyName,
}: {
	harness: HarnessStatus | undefined;
	model: string;
	onPick: (harness: HarnessStatus, model: string) => void;
	disabled?: boolean;
	/** What the chip reads while no model is picked, such as "Smallest". */
	emptyName?: string;
	side?: "top" | "bottom";
	/** Ignored: the kit picker owns its look. */
	className?: string;
}) {
	const prefs = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const check = useCheckHarness();
	const [adding, setAdding] = useState(false);
	const { harnesses, models, isLoading } = prefs;
	// Only agents that can run, plus the one this box is on, so a choice never vanishes (#907).
	const onList = harnesses
		.filter((h) => h.runnable || h.id === harness?.id)
		.sort(
			(a, b) => Number(b.id === harness?.id) - Number(a.id === harness?.id),
		);
	const isStarred = (h: HarnessStatus, id: string) =>
		models[h.id as HarnessId] === id;
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
				update.mutate({
					models: {
						[r.harness.id]: isStarred(r.harness, r.model) ? null : r.model,
					},
				});
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
	const option = (r: ModelRow, group: string, mark: string): PickerOption => ({
		id: pickId(r.harness, r.model),
		name: r.name,
		group,
		mark: <AgentMark id={mark} className="size-3.5" />,
		keywords: [r.model, r.provider ?? ""],
		...(r.warn ? { warn: true, description: r.warn } : {}),
		...(r.legacy && !r.warn ? { description: "Legacy" } : {}),
		trailing: star(r),
		testId: "model-option",
	});
	const starred = starredOf(harnesses, models).flatMap((f) => {
		const h = onList.find((x) => x.id === f.harness);
		return h
			? [
					option(
						{
							harness: h,
							model: f.model,
							name: modelName(h, f.model) ?? f.model,
						},
						"Starred",
						h.id,
					),
				]
			: [];
	});
	const options: PickerOption[] = [
		...starred,
		...onList.flatMap((h): PickerOption[] => {
			const state = modelState(h);
			if (state === "pending")
				return [
					{
						id: `check::${h.id}`,
						name: check.isPending ? "Checking" : "List its models",
						group: h.label,
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
						group: h.label,
						mark: <AgentMark id={h.id} className="size-3.5" />,
					},
				];
			const chosen =
				harness?.id === h.id ? model : (models[h.id as HarnessId] ?? "");
			return agentRows(h, prefs, chosen).map((r) =>
				option(r, h.label, PROVIDER_MARK[r.provider ?? ""] ?? h.id),
			);
		}),
	];
	// With none picked, the row ticked is the one the chip names: what the agent runs, else its first (#907).
	const current =
		harness &&
		(model && !isFoldedId(harness, model)
			? model
			: (defaultModel(harness, models[harness.id as HarnessId])?.id ?? model));
	return (
		<>
			<Picker
				label="Model"
				options={options}
				value={harness ? pickId(harness, current ?? "") : ""}
				onChange={(id) => {
					const [hid, ...rest] = id.split("::");
					const h = harnesses.find((x) => x.id === hid);
					if (h) onPick(h, rest.join("::"));
				}}
				display={{
					name: isLoading
						? "…"
						: !model && emptyName
							? emptyName
							: chipModel(harness, model),
					...(harness
						? { mark: <AgentMark id={harness.id} className="size-3.5" /> }
						: {}),
				}}
				actions={[
					{
						id: "add-agent",
						name: "Add agent",
						icon: Plus,
						run: () => setAdding(true),
						testId: "rail-add-agent",
					},
				]}
				searchPlaceholder="Search models"
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

/** Claude Code takes its 1M window as a model alias; no other agent offers a choice. */
const WINDOW_ALIAS = "[1m]";
const windowOf = (model: string) =>
	model.endsWith(WINDOW_ALIAS) ? "1M" : "200k";

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
				options={[{ id: "fixed", name: "Effort", icon: Gauge }]}
				value="fixed"
				onChange={() => undefined}
				locked={`${harness?.label ?? "This agent"} sets its own effort`}
				side={side}
				compact={compact}
				testId="effort-chip"
			/>
		);
	const windowed = harness.id === "claude-code";
	const win = windowOf(model);
	// The agent's own model has no id to alias, so 1M takes the id the agent serves.
	const base =
		(model.endsWith(WINDOW_ALIAS)
			? model.slice(0, -WINDOW_ALIAS.length)
			: model) ||
		harness.envModel?.model ||
		harness.checked?.servedModel ||
		"";
	const windows = base ? ["200k", "1M"] : ["200k"];
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
			options={options}
			value={[current.id, `window:${win}`]}
			onChange={(id) => {
				if (!id.startsWith("window:")) return onEffort(id);
				onModel(id === "window:1M" ? `${base}${WINDOW_ALIAS}` : base);
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
	if (!modes) {
		return (
			<Picker
				label="Permission"
				options={ACCESS_LEVELS.map((l) => ({
					id: `level:${l}`,
					name: ACCESS_LEVEL_LABEL[l],
					description: ACCESS_LEVEL_LINE[l],
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
			options={shown.map((m) => ({
				id: m.id,
				name: m.name,
				icon: modeIcon(m.id),
				...(m.description ? { description: m.description } : {}),
				testId: `access-mode-${m.id}`,
			}))}
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
