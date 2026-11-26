// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	defineProvider,
	type ProviderDef,
	type ProviderSpec,
} from "../descriptor.ts";

/** agent-host's permission levels; config's derivation fails to type-check if they part. */
export type AccessLevel = "supervised" | "auto-edits" | "auto" | "full-access";

/** What the last readiness check offered, as much of it as a row line reads. */
export type CheckedModes = {
	modes: readonly { id: string; name: string }[] | null;
} | null;

/** A package registry an install hint names: npm, or uv's PyPI with the first package the CLI. */
export type InstallChannel =
	| { npm: string }
	| { uv: readonly [string, ...string[]] };

/** The command an install hint gives for `channel`. */
export function installCommand(channel: InstallChannel): string {
	if ("npm" in channel) return `npm i -g ${channel.npm}`;
	const [cli, ...extras] = channel.uv;
	return [
		"uv tool install -U",
		cli,
		...extras.map((p) => `--with "${p}"`),
	].join(" ");
}

/** A mode by the agent's own name in the last check, else `fallback`. */
export function modeNamed(
	checked: CheckedModes,
	id: string,
	fallback: string,
): string {
	return checked?.modes?.find((m) => m.id === id)?.name ?? fallback;
}

export function offers(checked: CheckedModes, id: string): boolean {
	return !!checked?.modes?.some((m) => m.id === id);
}

/** The row line under each permission level: what this agent runs, by its own mode name when the check listed one. */
export type Lines = Record<AccessLevel, (checked: CheckedModes) => string>;

export function noModeLines(label: string): Lines {
	const line = () =>
		`${label} has no modes; PrismaLens answers its asks by this level.`;
	return {
		supervised: line,
		"auto-edits": line,
		auto: line,
		"full-access": line,
	};
}

export interface CatalogueSource {
	providers: readonly string[];
	/** Its model ids carry the provider as `provider/model`. */
	prefixed?: boolean;
	/** Its free models pay for themselves with your prompts. */
	freeIsTraining?: boolean;
}

/** What PrismaLens alone says and pins about an agent (#916); its launch facts are agent-host's row. */
export interface AgentFacts {
	/** One line the readiness check shows when the binary is missing; it names `channel`'s command. */
	install: string;
	/** Where `install` gets the agent's CLI from; the nightly probe installs from here (#1013). */
	channel?: InstallChannel;
	/** The vendor's next major, on its own package; the nightly probes its latest too (#1013). */
	nextChannel?: InstallChannel;
	/** The probed facts the next major answers differently from the row's own; the probe holds its latest to these (#1173). */
	nextFacts?: Partial<
		Record<
			"loadSession" | "images" | "embeddedContext" | "directories",
			boolean
		>
	>;
	/** One line the picker and the readiness check show: how to sign this agent in. */
	loginHint: string;
	/** Arguments to its own CLI that sign it in, staged in the terminal (#1171); absent, none. */
	signInArgs?: readonly string[];
	/** Arguments to its own CLI that sign it out, staged like Sign in (#1180); absent, none. */
	signOutArgs?: readonly string[];
	/** Arguments to its own CLI that sign in as another account (#1180); absent, none. */
	switchAccountArgs?: readonly string[];
	/** Arguments to its own updater, which updates whatever install runs (#1180); absent, the install channel decides. */
	updateArgs?: readonly string[];
	/** Its own updater when no npm or Homebrew install is found; a found channel updates through itself (#1180). */
	updateFallbackArgs?: readonly string[];
	/** Its Homebrew names, so an install under `Caskroom/<cask>` or `Cellar/<formula>` updates through brew (#1180). */
	brew?: { cask?: string; formula?: string };
	/** The agent's documented update route, shown as text when no channel is known (#1180). */
	updateLine?: string;
	/** Env vars that move where its login lives; a stored one leaves Sign in to the copied hint (#1171). */
	loginEnvKeys?: readonly string[];
	/** Its adapter reports usage-limit windows on a run (#1171). */
	reportsLimits?: true;
	/** The model PrismaLens asks for when the operator set none: the id the compatibility run passed on (#337 run e). */
	defaultModel?: string;
	/** The version a compatibility run passed on (ADR 0003 §10), or absent: never run. */
	tested?: { version: string; date: string; companion?: string };
	/** Its entries in the bundled ACP registry, so Add agent never lists it twice (#911). */
	acpRegistryIds?: readonly string[];
	/** What the run view says when PrismaLens's tools did not reach this agent (#848). */
	toolsHint?: { text: string };
	/** PrismaLens's tools come as a core plus `pl_tools_search`, on only where the scripted-model matrix measured it (#848). */
	harnessToolSearch?: true;
	/** Minutes the agent's prompt cache lives idle; null when no source states it (#1024). */
	cacheTtlMinutes: number | null;
	/** Percent of the window where the agent compacts by itself; null when no source states it (#1101). */
	autoCompactPercent: number | null;
	/** The agent compacts an idle session itself, so PrismaLens never does (#1024). */
	compactsWhenIdle: boolean;
	/** The command that compacts the session, without its slash; null when it has none. */
	compactCommand: string | null;
	/** Its compact command takes focus instructions after the name (#1024). */
	compactTakesFocus: boolean;
	/** A larger context window taken as a suffix on the model id; absent, the agent offers one window. */
	modelWindow?: { alias: string; base: string; large: string };
	/** A multi-provider agent whose CLI lists the providers it holds a login for; `keyless` providers run with none. */
	providerAuth?: { args: readonly string[]; keyless: readonly string[] };
	/** With no model over ACP, the agent runs a model it chooses itself, so there is no list to wait for. */
	picksOwnModel?: true;
	/** The user sets its command and arguments in Settings; no binary is looked up. */
	commandSetByUser?: true;
	/** The file its own default permission is read from, as a Settings line names it. */
	settingsFile?: string;
	/** Why it has no single permission level, where it has modes but they are not levels. */
	noLevelReason?: string;
	/** What its own settings still decide, under the Settings rows (#673 w21); null, nothing to say. */
	ownSettingsNote?: (checked: CheckedModes) => string | null;
	/** One line on how a level becomes its permission rules (#673 w21). */
	permissionRulesNote?: string;
	/** The provider that makes and bills its models, by its models.dev id (`providerFacts`). */
	vendor?: string;
	/** Where its fallback model list comes from in the models.dev snapshot (`catalogue-sources.json`). */
	catalogue?: CatalogueSource;
	/** What its adapter forwards over ACP besides tokens (pattern sheet §7); absent, unknown. */
	usageReports?: readonly ("cache" | "cost" | "limits")[];
	lines: Lines;
}

export interface AgentSpec extends ProviderSpec<"agent"> {
	/** The agent-host launch row this agent runs, by id; the API joins it, so the descriptor imports nothing built. */
	readonly launch: string;
	readonly facts: AgentFacts;
}

export type AgentDef = ProviderDef<"agent"> &
	Pick<AgentSpec, "launch" | "facts">;

/** One agent. Export it from `agent/<id>/<id>.provider.ts`. */
export const defineAgent = (spec: AgentSpec): AgentDef =>
	defineProvider(spec) as AgentDef;

export const isAgent = (p: ProviderDef): p is AgentDef =>
	p.family === "agent" && typeof (p as AgentDef).launch === "string";

/** An agent's `pin.json`: the CLI CI installs, the adapter it moves with, and what a compatibility run passed on. */
export interface AgentPin {
	/** `channel` is `npm` or `pypi`; JSON imports widen it, so `channelOf` checks it. `bin` answers `--version`. */
	cli: { package: string; version: string; channel: string; bin: string };
	/** Mirrors `agent-adapters/package.json`, which pnpm installs from; a script test holds the two equal. */
	adapter?: { package: string; version: string };
	/** Packages a Python CLI installs beside it. */
	with?: readonly string[];
	constraints?: readonly string[];
	why?: string;
	minimumReleaseAgeDays?: number;
	tested?: { version: string; date: string; companion?: string };
	/** 1: its qualification leg gates a PR; 2: a red leg is reported and does not. */
	tier: number;
}

/** The channel the install hint names, from the pin: users install what CI pins (#1013). */
export function channelOf(pin: AgentPin): InstallChannel {
	if (pin.cli.channel === "npm") return { npm: pin.cli.package };
	if (pin.cli.channel === "pypi")
		return { uv: [pin.cli.package, ...(pin.with ?? [])] };
	throw new Error(
		`${pin.cli.package}: channel ${pin.cli.channel} is not npm or pypi`,
	);
}

/** The pin's `tested`, spread into the facts only when a compatibility run recorded one. */
export const testedOf = (pin: AgentPin): Pick<AgentFacts, "tested"> =>
	pin.tested ? { tested: pin.tested } : {};
