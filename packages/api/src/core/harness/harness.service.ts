// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9). The harness is the first registry row on
 * PATH, unless PRISMALENS_HARNESS or the persisted setting pins one.
 * Prismalens never bundles, installs or authenticates a harness.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	Optional,
} from "@nestjs/common";
import type { LaunchPolicy } from "@prismalens/agent-host";
import {
	type HarnessSelection,
	isWindowsMountPath,
	isWsl,
	listHarnessStatus,
	resolveHarnessSelection,
} from "@prismalens/config";
import {
	ACCESS_LEVELS,
	type AccessLevel,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	isSafeGatewayUrl,
	preferredModel,
	providerSignedOutLine,
	providerSignIn,
	refuseModel,
	reservedEnvNames,
	signInCommand,
	versionVsTested,
} from "@prismalens/config/harness";
import {
	type HarnessSelectionInput,
	isExecutableFile,
	type LaunchProbe,
	launchProbeOf,
	resolveOnPath,
} from "@prismalens/config/harness-selection";
import {
	type AgentEnvVar,
	COLD_RESUME_TOKENS,
	effectiveAccess,
	type FavouriteModel,
	type HarnessesResponse,
	type HarnessProbeOutcome,
	type HarnessProbeResult,
	type HarnessStatus,
	type LocalAgent,
	type LocalDefault,
	MODEL_USES,
	type ModelUse,
	RUNTIME_HOST_ONLY,
	type RunChoice,
	type RunRuntimeNote,
	type ThreadTitleSettings,
	ThreadTitleSettingsSchema,
	type UseDefault,
	UseDefaultSchema,
} from "@prismalens/contracts/schemas";
import { localDefault, prismalensLaunchPolicy } from "@prismalens/engine";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
	ChecksSnapshotSchema,
	HarnessModelsService,
} from "./harness-models.service.js";
import { HarnessProbeService } from "./harness-probe.service.js";

/** How long a remembered "ready" stands before a run checks again; "not ready" is never reused (#673 w9). */
export const READY_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

export type Readiness = { ready: true } | { ready: false; reason: string };

type Check = NonNullable<HarnessStatus["checked"]>;

/** A failed check in the words the box, the picker and the Timeline share: "<agent>: <detail>". */
function notReadyReason(id: HarnessId, check: Pick<Check, "detail">): string {
	return `${HARNESS_REGISTRY[id].label}: ${check.detail}`;
}

const SETTING_KEY = "HARNESS";
/** Each agent's last check, so a restart keeps what Settings showed (#1171). */
const CHECKS_KEY = "HARNESS_CHECKS";
/** `{ [harnessId]: { [NAME]: base64 ciphertext } }`; values never go back to a client (#907). */
const ENV_KEY = "HARNESS_ENV";
const MAX_ENV_NAMES = 50;

/** A refused settings write, in the words the field shows; the controller maps `code` to the oRPC error. */
export class HarnessSettingsError extends Error {
	constructor(
		message: string,
		readonly code: "BAD_REQUEST" | "FORBIDDEN" = "BAD_REQUEST",
	) {
		super(message);
	}
}

/** What a spawn of one agent uses from Settings (#907): the floor's host env < config dir < Environment rows. */
export interface AgentRuntime {
	/** The stored layer: the config dir and the Environment rows; the launch plan adds the host's. */
	env: Record<string, string>;
	/** Which host variables reach the agent: Settings' strict mode or not (#817); the default floor when absent. */
	policy?: LaunchPolicy;
	binaryPath?: string;
	/** `local` only. */
	launchArgs?: string[];
	/** Recorded as `fidelity.runtime`; null when Settings set nothing for this agent. */
	note: RunRuntimeNote | null;
	/** The host let alert and schedule runs keep the GitHub token (#1020). */
	unattendedGithub?: boolean;
	/** Settings → Agent → Advanced; absent is the agent's own default (#1024 spec B). */
	subagentLimits?: {
		depth?: number;
		concurrency?: number;
		onStop?: "stop" | "finish";
	};
}

export interface HarnessSettings {
	/** "auto" or a registry id. PRISMALENS_HARNESS always wins over this. */
	harness: "auto" | HarnessId;
	/** Model id per harness, in that harness's own format; absent means its default. */
	models?: Partial<Record<HarnessId, string>>;
	/** Starred models across agents (R4.2), shown first in the picker. */
	favourites?: FavouriteModel[];
	/** Effort per harness, a value of its `thought_level` option (R4.2). */
	efforts?: Partial<Record<HarnessId, string>>;
	/** Permission level per harness for the next run (#673 w21); absent follows the agent's own default. */
	accessLevels?: Partial<Record<HarnessId, AccessLevel>>;
	/** Model ids the operator added per harness (#673 w57). */
	customModels?: Partial<Record<HarnessId, string[]>>;
	/** Models left out of the picker per agent (#907). */
	hiddenModels?: Partial<Record<HarnessId, string[]>>;
	/** The operator's model order per agent. */
	modelOrder?: Partial<Record<HarnessId, string[]>>;
	/** The agent's own program, absolute (#907). */
	binaryPaths?: Partial<Record<HarnessId, string>>;
	/** The folder its config-dir env var points at, absolute. */
	configDirs?: Partial<Record<HarnessId, string>>;
	localAgent?: LocalAgent;
	/** Only pass named variables to the agent (#817); off by default. */
	strictEnv?: boolean;
	/** Stored only when on: alert and schedule runs keep the GitHub token (#1020). */
	unattendedGithub?: boolean;
	/** Stored only when `wait`: an alert-started run's asks wait for a person (#1020). */
	alertAsks?: "wait";
	/** Stored only when off: runs a restart cut off resume by default (#981). */
	resumeAfterRestart?: boolean;
	/** A long-idle thread with a large context (#1024); absent asks. */
	coldResume?: "ask" | "compact" | "send";
	/** Only ask above this many context tokens; absent is COLD_RESUME_TOKENS. */
	coldResumeTokens?: number;
	/** Stored only when off: a usage limit schedules a resume (#1024). */
	resumeAfterLimit?: boolean;
	/** Stored only when on: idle threads are compacted (#1024). */
	compactIdle?: boolean;
	/** In-session sub-agent limits (#1024 spec B); unset is the agent's own default. */
	subagentDepth?: number;
	subagentConcurrency?: number;
	/** Stored only when "finish": a stopped turn's sub-agents stop with it otherwise. */
	subagentsOnStop?: "stop" | "finish";
	/** Per-use agent and model (#1101 cat 18). */
	useDefaults?: Partial<Record<ModelUse, UseDefault>>;
	/** Settings → Models → Thread titles (#1101). */
	threadTitles?: ThreadTitleSettings;
	/** Read from HARNESS_ENV: names only. */
	envNames?: Partial<Record<HarnessId, string[]>>;
	/** Turned off: auto and new runs skip them (#1171). */
	off?: HarnessId[];
	/** Put through Add agent without passing; listed anyway (#1171). */
	added?: HarnessId[];
}

const AXES = ["accessLevels"] as const;
type Axis = (typeof AXES)[number];
const AXIS_VALUES: Record<Axis, readonly string[]> = {
	accessLevels: ACCESS_LEVELS,
};

export interface HarnessSettingsPatch {
	harness?: "auto" | HarnessId;
	/** Merged per harness; `null` clears that harness's model. */
	models?: Partial<Record<HarnessId, string | null>>;
	/** Replaces the whole list. */
	favourites?: FavouriteModel[];
	/** Merged per harness; `null` goes back to the harness's own default. */
	efforts?: Partial<Record<HarnessId, string | null>>;
	/** Each merged per harness; `null` goes back to the default. */
	accessLevels?: Partial<Record<HarnessId, AccessLevel | null>>;
	/** Replaces that harness's list; `null` clears it. */
	customModels?: Partial<Record<HarnessId, string[] | null>>;
	hiddenModels?: Partial<Record<HarnessId, string[] | null>>;
	modelOrder?: Partial<Record<HarnessId, string[] | null>>;
	/** Runtime fields (#907): host only, each merged per agent; `null` clears. */
	binaryPaths?: Partial<Record<HarnessId, string | null>>;
	configDirs?: Partial<Record<HarnessId, string | null>>;
	env?: Partial<Record<HarnessId, Record<string, string | null>>>;
	localAgent?: LocalAgent | null;
	strictEnv?: boolean;
	unattendedGithub?: boolean;
	alertAsks?: "decide" | "wait";
	resumeAfterRestart?: boolean;
	/** A long-idle thread with a large context (#1024); absent asks. */
	coldResume?: "ask" | "compact" | "send";
	/** Only ask above this many context tokens; absent is COLD_RESUME_TOKENS. */
	coldResumeTokens?: number;
	/** Stored only when off: a usage limit schedules a resume (#1024). */
	resumeAfterLimit?: boolean;
	/** Stored only when on: idle threads are compacted (#1024). */
	compactIdle?: boolean;
	/** `null` goes back to the agent's own default. */
	subagentDepth?: number | null;
	subagentConcurrency?: number | null;
	subagentsOnStop?: "stop" | "finish";
	/** Merged per use; `null` clears that use. */
	useDefaults?: Partial<Record<ModelUse, UseDefault | null>>;
	/** Replaces the block; `null` clears it. */
	threadTitles?: ThreadTitleSettings | null;
	/** Each merged per agent; `false` takes it out. */
	off?: Partial<Record<HarnessId, boolean>>;
	added?: Partial<Record<HarnessId, boolean>>;
}

const RUNTIME_FIELDS = [
	"binaryPaths",
	"configDirs",
	"env",
	"localAgent",
	"strictEnv",
	"unattendedGithub",
	"alertAsks",
	"resumeAfterRestart",
	"subagentDepth",
	"subagentConcurrency",
	"subagentsOnStop",
	"useDefaults",
	"threadTitles",
] as const satisfies readonly (keyof HarnessSettingsPatch)[];

/** Per-use defaults that still name a known agent; `null` or junk drops the use. */
function cleanUseDefaults(raw: unknown): Partial<Record<ModelUse, UseDefault>> {
	if (!raw || typeof raw !== "object") return {};
	const out: Partial<Record<ModelUse, UseDefault>> = {};
	for (const use of MODEL_USES) {
		const parsed = UseDefaultSchema.safeParse(
			(raw as Record<string, unknown>)[use],
		);
		if (parsed.success) out[use] = parsed.data;
	}
	return out;
}

/** The stored thread-title block; junk reads as the defaults. */
function cleanThreadTitles(raw: unknown): ThreadTitleSettings {
	const parsed = ThreadTitleSettingsSchema.safeParse(raw);
	return parsed.success ? parsed.data : {};
}

/** One use's stored default, for a service that reads it without the harness service (thread tree). */
export async function storedUseDefault(
	prisma: Pick<PrismaService, "setting">,
	use: ModelUse,
): Promise<UseDefault | undefined> {
	const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
	try {
		return cleanUseDefaults(JSON.parse(row?.value ?? "{}").useDefaults)[use];
	} catch {
		return undefined;
	}
}

/** A stored sub-agent limit, 1 to 8; anything else reads as unset. */
function subagentLimit(raw: unknown): number | undefined {
	return typeof raw === "number" &&
		Number.isInteger(raw) &&
		raw >= 1 &&
		raw <= 8
		? raw
		: undefined;
}

/** The two limits as fields, each only when set. */
function subagentLimitFields(depth: unknown, concurrency: unknown) {
	const d = subagentLimit(depth);
	const c = subagentLimit(concurrency);
	return {
		...(d !== undefined ? { subagentDepth: d } : {}),
		...(c !== undefined ? { subagentConcurrency: c } : {}),
	};
}

/** Keeps only registry ids with a non-empty string; anything else in the stored JSON is dropped (models, efforts and modes alike). */
function cleanModels(raw: unknown): Partial<Record<HarnessId, string>> {
	const out: Partial<Record<HarnessId, string>> = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [id, model] of Object.entries(raw)) {
		if (
			HARNESS_IDS.includes(id as HarnessId) &&
			typeof model === "string" &&
			model.trim()
		)
			out[id as HarnessId] = model.trim();
	}
	return out;
}

/** One axis per harness: a value this build knows survives, anything else is dropped (#673 w21). */
function cleanAxis(
	axis: Axis,
	raw: unknown,
): Partial<Record<HarnessId, string>> {
	const out = cleanModels(raw);
	for (const id of Object.keys(out) as HarnessId[])
		if (!AXIS_VALUES[axis].includes(out[id] ?? "")) delete out[id];
	return out;
}

/** The four axis maps of `raw`, each with its unknown values dropped and empty maps left out. */
function cleanAxes(
	raw: Partial<Record<Axis, unknown>>,
): Pick<HarnessSettings, Axis> {
	const out: Record<string, unknown> = {};
	for (const axis of AXES) {
		const values = cleanAxis(axis, raw[axis]);
		if (Object.keys(values).length) out[axis] = values;
	}
	return out as Pick<HarnessSettings, Axis>;
}

/** Custom model ids per harness: trimmed, deduplicated, empty lists dropped (#673 w57). */
function cleanCustomModels(raw: unknown): Partial<Record<HarnessId, string[]>> {
	const out: Partial<Record<HarnessId, string[]>> = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [id, list] of Object.entries(raw)) {
		if (!HARNESS_IDS.includes(id as HarnessId) || !Array.isArray(list))
			continue;
		const ids = [
			...new Set(
				list
					.filter((m): m is string => typeof m === "string")
					.map((m) => m.trim())
					.filter(Boolean),
			),
		];
		if (ids.length) out[id as HarnessId] = ids;
	}
	return out;
}

/** A list per agent, capped like the contract (#907). */
function cleanLists(raw: unknown): Partial<Record<HarnessId, string[]>> {
	const out = cleanCustomModels(raw);
	for (const id of Object.keys(out) as HarnessId[])
		out[id] = out[id]?.slice(0, 500);
	return out;
}

/** Registry ids, deduplicated, in registry order. */
function cleanIds(raw: unknown): HarnessId[] {
	if (!Array.isArray(raw)) return [];
	return HARNESS_IDS.filter((id) => raw.includes(id));
}

/** `current` with each patched id put in (true) or taken out (false). */
function mergeIds(
	current: HarnessId[] | undefined,
	patch: Partial<Record<HarnessId, boolean>> | undefined,
): HarnessId[] {
	const out = new Set(current ?? []);
	for (const [id, on] of Object.entries(patch ?? {}) as [HarnessId, boolean][])
		if (on) out.add(id);
		else out.delete(id);
	return cleanIds([...out]);
}

function cleanLocalAgent(raw: unknown): LocalAgent | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const { command, args } = raw as Partial<LocalAgent>;
	if (typeof command !== "string" || !command.trim()) return undefined;
	return {
		command,
		args: Array.isArray(args)
			? args.filter((a): a is string => typeof a === "string").slice(0, 32)
			: [],
	};
}

/** `{ [key]: value }` when it holds anything, else nothing. */
/** The variables an agent reads and those stored for it, each by state; a stored value wins over the host's (#907). */
export function envVarStates(
	id: HarnessId,
	stored: readonly string[],
	host: NodeJS.ProcessEnv = process.env,
): AgentEnvVar[] {
	const keys = (HARNESS_REGISTRY[id].providerKeys ?? []).filter(
		(k) => !k.startsWith("PRISMALENS_"),
	);
	const saved = new Set(stored);
	const names = Array.from(new Set([...keys, ...[...stored].sort()]));
	return names.map((name) => {
		const inHost = keys.includes(name) && host[name] !== undefined;
		return {
			name,
			state: saved.has(name) ? "set" : inHost ? "env" : "unset",
			inEnv: saved.has(name) && inHost,
		};
	});
}

function nonEmpty<K extends string, V extends object>(
	key: K,
	value: V,
): Partial<Record<K, V>> {
	return Object.keys(value).length
		? ({ [key]: value } as Partial<Record<K, V>>)
		: {};
}

/** `~/` expanded; null when the result is not absolute. */
function expandHome(raw: string): string | null {
	const path = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	return isAbsolute(path) ? path : null;
}

/** A program path as stored: absolute, or a bare name found on PATH. */
function programPath(raw: string): string {
	const trimmed = raw.trim();
	const path =
		expandHome(trimmed) ??
		(/[\\/]/.test(trimmed) ? null : resolveOnPath(trimmed));
	if (!path)
		throw new HarnessSettingsError(
			"Use a full path, like /usr/local/bin/claude.",
		);
	if (isWsl() && isWindowsMountPath(path))
		throw new HarnessSettingsError(
			`${path} is a Windows install; it can't run in WSL.`,
		);
	if (!isExecutableFile(path))
		throw new HarnessSettingsError(`No program at ${path}.`);
	return path;
}

function folderPath(raw: string): string {
	const path = expandHome(raw.trim());
	let isDir = false;
	try {
		isDir = !!path && statSync(path).isDirectory();
	} catch {
		isDir = false;
	}
	if (!path || !isDir)
		throw new HarnessSettingsError(`No folder at ${path ?? raw.trim()}.`);
	return path;
}

/** Why `name` can't be set for this agent in Settings, or null. */
function refuseEnvName(id: HarnessId, name: string): string | null {
	const row = HARNESS_REGISTRY[id];
	if (row.configDir?.envKey.toUpperCase() === name.toUpperCase())
		return `Set ${name} with Config directory above.`;
	if (name.startsWith("PRISMALENS_") || reservedEnvNames(id).includes(name))
		return `${row.label} runs get ${name} from PrismaLens; it can't be set here.`;
	return null;
}

/** Starred models, deduplicated, each naming a harness this build knows. */
function cleanFavourites(raw: unknown): FavouriteModel[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: FavouriteModel[] = [];
	for (const f of raw as Array<Partial<FavouriteModel>>) {
		const model = typeof f?.model === "string" ? f.model.trim() : "";
		if (!model || !HARNESS_IDS.includes(f?.harness as HarnessId)) continue;
		const key = `${f.harness}\u0000${model}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ harness: f.harness as HarnessId, model });
	}
	return out;
}

/** Merges per agent; null clears; each set value goes through `clean`, which may refuse. */
function mergeRuntime(
	current: Partial<Record<HarnessId, string>> | undefined,
	patch: Partial<Record<HarnessId, string | null>> | undefined,
	clean: (id: HarnessId, raw: string) => string,
): Partial<Record<HarnessId, string>> {
	const out = { ...current };
	for (const [id, raw] of Object.entries(patch ?? {}) as [
		HarnessId,
		string | null | undefined,
	][]) {
		if (raw === undefined) continue;
		if (raw === null) delete out[id];
		else out[id] = clean(id, raw);
	}
	return out;
}

@Injectable()
export class HarnessService implements OnApplicationBootstrap {
	private readonly logger = new Logger(HarnessService.name);
	/** One probe per harness at a time: a second caller shares the first's answer. */
	private readonly inFlight = new Map<HarnessId, Promise<Check | null>>();

	/** The last settings read, so the sync follow-up gate sees binary paths (#907). */
	private lastSettings: HarnessSettings = { harness: "auto" };
	/** The last HARNESS_ENV read, ciphertext only, for the runtime key. */
	private lastStored: Partial<Record<HarnessId, Record<string, string>>> = {};
	/** Moves on each committed settings write: a read begun before it must not overwrite the cache after it. */
	private cacheEpoch = 0;
	/** Per agent, the last probe start number handed out (#1171). */
	private readonly started = new Map<HarnessId, number>();
	/** HARNESS_CHECKS writes, one at a time; each writes the maps as they are then. */
	private persisting: Promise<void> = Promise.resolve();

	constructor(
		private readonly prisma: PrismaService,
		private readonly models: HarnessModelsService = new HarnessModelsService(),
		private readonly probe: HarnessProbeService = new HarnessProbeService(
			models,
		),
		@Optional() private readonly credentials?: CredentialsService,
	) {}

	/** Check each installed agent once, in the background, so the picker is right on first open. */
	onApplicationBootstrap(): void {
		if (process.env.NODE_ENV === "test") return;
		void this.restoreChecks().then(() => this.sweep());
	}

	async sweep(): Promise<void> {
		const settings = await this.getSettings();
		const off = new Set(settings.off);
		for (const h of listHarnessStatus(this.selectionInput(settings))) {
			if (h.installed && !off.has(h.id)) await this.checkOnce(h.id);
		}
	}

	/** Every agent this machine can start, off or not. */
	async installedIds(): Promise<HarnessId[]> {
		const settings = await this.getSettings();
		return listHarnessStatus(this.selectionInput(settings))
			.filter((h) => h.installed)
			.map((h) => h.id);
	}

	/** What the launch probe needs from Settings, and auto's skip of an off agent or a failed check (#907, #1171). */
	private selectionInput(s: HarnessSettings): HarnessSelectionInput {
		const off = new Set(s.off);
		return {
			...(s.binaryPaths ? { binaryPaths: s.binaryPaths } : {}),
			localAgent: s.localAgent ?? null,
			isRunnable: (id) => !off.has(id) && this.checkPasses(id),
			isSignedIn: (id) => this.providerKnown(id, s.models?.[id]),
		};
	}

	/**
	 * What a check of `id` runs under, as a hash: a check is shown only while this matches (#1171).
	 * A stored variable's ciphertext changes on each write, so it stands in for a revision counter.
	 */
	private runtimeKey(
		id: HarnessId,
		s: HarnessSettings = this.lastSettings,
		stored: Partial<Record<HarnessId, Record<string, string>>> = this
			.lastStored,
	): string {
		const row = HARNESS_REGISTRY[id];
		const cipher = Object.entries(stored[id] ?? {}).sort(([a], [b]) =>
			a.localeCompare(b),
		);
		return createHash("sha256")
			.update(
				JSON.stringify({
					binaryPath: id === "local" ? null : (s.binaryPaths?.[id] ?? null),
					configDir: row.configDir ? (s.configDirs?.[id] ?? null) : null,
					local: id === "local" ? (s.localAgent ?? null) : null,
					strict: s.strictEnv === true,
					env: cipher,
				}),
			)
			.digest("hex");
	}

	/** Loads HARNESS_CHECKS; an unreadable row is logged once and the checks start empty. */
	private async restoreChecks(): Promise<void> {
		await this.getSettings();
		const row = await this.prisma.setting.findUnique({
			where: { key: CHECKS_KEY },
		});
		if (!row) return;
		try {
			const snapshot = ChecksSnapshotSchema.parse(JSON.parse(row.value));
			this.models.restore(snapshot, (id) => this.runtimeKey(id));
		} catch (err) {
			this.logger.warn(
				`${CHECKS_KEY} unreadable, checks start empty: ${(err as Error).message}`,
			);
		}
	}

	/** Writes the kept checks; queued, so the last write holds the current maps. */
	private persistChecks(): Promise<void> {
		this.persisting = this.persisting.then(async () => {
			const value = JSON.stringify(this.models.snapshot());
			await this.prisma.setting
				.upsert({
					where: { key: CHECKS_KEY },
					update: { value, type: "json" },
					create: { key: CHECKS_KEY, value, type: "json", category: "ai" },
				})
				.catch((err: unknown) =>
					this.logger.warn(
						`${CHECKS_KEY} not saved: ${(err as Error).message}`,
					),
				);
		});
		return this.persisting;
	}

	/** Auto prefers an agent whose provider login for its model is known; one it could not read waits behind. */
	private providerKnown(id: HarnessId, model: string | undefined): boolean {
		const c = this.models.checked(id);
		const chosen = model ?? this.runModelOf(id);
		// No model to read a login for: auto keeps its order; the status says Sign-in not checked.
		if (!chosen) return true;
		const state = providerSignIn(id, c, chosen);
		return state === "na" || state === "signed-in";
	}

	/** The model a run on `id` takes when none is starred or asked: one whose provider is signed in. */
	runModelOf(id: HarnessId): string | null {
		// Only models the agent itself listed: a catalogue one may be a name it does not know.
		const listed = this.models.modelsFor(id, this.models.catalogue());
		return preferredModel(
			id,
			this.models.checked(id),
			listed.source === "harness" ? listed.entries : [],
		);
	}

	/** A model to send when none is starred: only one that replaces the agent's own default, else null. */
	runModelOverride(id: HarnessId): string | null {
		const model = this.runModelOf(id);
		return model && model !== this.models.checked(id)?.servedModel
			? model
			: null;
	}

	private checkPasses(id: HarnessId): boolean {
		const c = this.models.checked(id);
		return !c || c.outcome === "answers-acp";
	}

	/** The launch probe for one agent from the last settings read; sync, for the follow-up gate. */
	launchProbe(id: HarnessId): LaunchProbe {
		return launchProbeOf(this.selectionInput(this.lastSettings), id);
	}

	/** One agent's spawn inputs from Settings (#907). */
	async runtimeFor(id: HarnessId): Promise<AgentRuntime> {
		const settings = await this.getSettings();
		return this.runtimeOf(id, settings, await this.readEnv());
	}

	private runtimeOf(
		id: HarnessId,
		s: HarnessSettings,
		stored: Partial<Record<HarnessId, Record<string, string>>>,
	): AgentRuntime {
		const row = HARNESS_REGISTRY[id];
		const local = id === "local" ? s.localAgent : undefined;
		const binaryPath = local ? local.command : s.binaryPaths?.[id];
		const configDir = row.configDir ? s.configDirs?.[id] : undefined;
		const rows = this.decryptRows(stored[id]);
		const env = {
			...(configDir && row.configDir
				? { [row.configDir.envKey]: configDir }
				: {}),
			...rows,
		};
		const strict = s.strictEnv === true;
		// Checked after the rows overlay the host: a saved https gateway fixes an unsafe host one (#911).
		const gateway =
			rows.ANTHROPIC_BASE_URL ??
			(row.providerKeys.includes("ANTHROPIC_BASE_URL")
				? process.env.ANTHROPIC_BASE_URL
				: undefined);
		if (gateway && !isSafeGatewayUrl(gateway))
			throw new Error(
				`ANTHROPIC_BASE_URL must be https unless it points at this machine: ${gateway}`,
			);
		const envNames = Object.keys(rows).sort();
		const args = local?.args ?? [];
		const set = !!binaryPath || !!configDir || envNames.length > 0;
		return {
			env,
			policy: prismalensLaunchPolicy({ strict }),
			...(s.unattendedGithub === true ? { unattendedGithub: true } : {}),
			subagentLimits: {
				...(s.subagentDepth !== undefined ? { depth: s.subagentDepth } : {}),
				...(s.subagentConcurrency !== undefined
					? { concurrency: s.subagentConcurrency }
					: {}),
				onStop: s.subagentsOnStop ?? "stop",
			},
			...(binaryPath ? { binaryPath } : {}),
			...(local ? { launchArgs: args } : {}),
			note: set
				? {
						binaryPath: binaryPath ?? null,
						configDir: configDir ?? null,
						envNames,
						args,
					}
				: null,
		};
	}

	/** An agent whose runtime is refused still lists, without it; only its own run fails. */
	private listedRuntime(
		id: HarnessId,
		s: HarnessSettings,
		stored: Partial<Record<HarnessId, Record<string, string>>>,
	): AgentRuntime | null {
		try {
			return this.runtimeOf(id, s, stored);
		} catch (err) {
			this.logger.warn(`${id}: ${(err as Error).message}`);
			return null;
		}
	}

	private decryptRows(
		rows: Record<string, string> | undefined,
	): Record<string, string> {
		const out: Record<string, string> = {};
		if (!rows || !this.credentials) return out;
		for (const [name, cipher] of Object.entries(rows)) {
			try {
				out[name] = this.credentials.decryptFromBase64<string>(cipher);
			} catch (err) {
				this.logger.warn(
					`Agent variable ${name} could not be decrypted: ${(err as Error).message}`,
				);
			}
		}
		return out;
	}

	private async readEnv(): Promise<
		Partial<Record<HarnessId, Record<string, string>>>
	> {
		const epoch = this.cacheEpoch;
		const row = await this.prisma.setting.findUnique({
			where: { key: ENV_KEY },
		});
		if (!row) {
			if (epoch === this.cacheEpoch) this.lastStored = {};
			return {};
		}
		try {
			const parsed = JSON.parse(row.value) as Record<string, unknown>;
			const out: Partial<Record<HarnessId, Record<string, string>>> = {};
			for (const [id, rows] of Object.entries(parsed)) {
				if (!HARNESS_IDS.includes(id as HarnessId)) continue;
				if (!rows || typeof rows !== "object") continue;
				const kept = Object.fromEntries(
					Object.entries(rows).filter(
						(e): e is [string, string] => typeof e[1] === "string",
					),
				);
				if (Object.keys(kept).length) out[id as HarnessId] = kept;
			}
			if (epoch === this.cacheEpoch) this.lastStored = out;
			return out;
		} catch {
			return {};
		}
	}

	/** The Settings Check button: the handshake with this agent's runtime (#907). */
	async check(id: HarnessId): Promise<HarnessProbeResult> {
		const seq = this.reserve(id);
		const { runtime, guard } = await this.probeInputs(id);
		const result = await this.probe.check(id, runtime, guard, seq);
		void this.persistChecks();
		return result;
	}

	/** The next probe start number for `id`, taken before any await so an older read never outranks a newer one. */
	private reserve(id: HarnessId): number {
		const seq = (this.started.get(id) ?? 0) + 1;
		this.started.set(id, seq);
		return seq;
	}

	/** The runtime and its key from one settings and env read, so a probe is keyed by what it ran (#1171). */
	private async probeInputs(id: HarnessId) {
		const settings = await this.getSettings();
		const stored = await this.readEnv();
		return {
			runtime: this.runtimeOf(id, settings, stored),
			guard: {
				key: this.runtimeKey(id, settings, stored),
				current: () => this.runtimeKey(id),
			},
		};
	}

	/** Turned off in Settings, unless `PRISMALENS_HARNESS` names it. */
	private async isOff(id: HarnessId): Promise<boolean> {
		const settings = await this.getSettings();
		return (
			(settings.off?.includes(id) ?? false) &&
			process.env.PRISMALENS_HARNESS?.trim() !== id
		);
	}

	private offMessage(id: HarnessId): string {
		return `${HARNESS_REGISTRY[id].label} is off. Turn it on in Settings → Agents.`;
	}

	/**
	 * Would a run on this agent start? A remembered `answers-acp` under a day
	 * old, else a check now: a remembered failure is checked again, so signing
	 * in takes effect on the next run (#673 w9).
	 */
	async ensureReady(id: HarnessId, model?: string | null): Promise<Readiness> {
		const off = { ready: false, reason: this.offMessage(id) } as const;
		if (await this.isOff(id)) return off;
		const remembered = this.models.checked(id);
		const fresh =
			remembered?.outcome === "answers-acp" &&
			Date.now() - Date.parse(remembered.at) < READY_CHECK_TTL_MS;
		const check = fresh ? remembered : await this.checkOnce(id);
		if (!check)
			return {
				ready: false,
				reason: `${HARNESS_REGISTRY[id].label}: the readiness check did not run`,
			};
		// Turned off while the probe ran: its answer no longer stands.
		if (!fresh && (await this.isOff(id))) return off;
		if (check.outcome !== "answers-acp")
			return { ready: false, reason: notReadyReason(id, check) };
		const settings = await this.getSettings();
		const chosen = model ?? settings.models?.[id] ?? this.runModelOf(id);
		if (providerSignIn(id, check, chosen) === "signed-out")
			return { ready: false, reason: providerSignedOutLine(id, chosen) };
		return { ready: true };
	}

	private checkOnce(id: HarnessId): Promise<Check | null> {
		const running = this.inFlight.get(id);
		if (running) return running;
		const seq = this.reserve(id);
		const next: Promise<Check | null> = this.probeInputs(id)
			.then(({ runtime, guard }) => this.probe.check(id, runtime, guard, seq))
			.then(() => {
				void this.persistChecks();
				return this.models.checked(id) ?? null;
			})
			.catch((err: unknown) => {
				this.logger.warn(
					`Readiness check for ${id} failed: ${(err as Error).message}`,
				);
				return null;
			})
			.finally(() => {
				if (this.inFlight.get(id) === next) this.inFlight.delete(id);
			});
		this.inFlight.set(id, next);
		return next;
	}

	/** Reads the agent's own default from the user's settings file; tests swap it (#673 w21). */
	localDefaultOf: (
		id: HarnessId,
		env?: Record<string, string>,
	) => LocalDefault = (id, env) =>
		localDefault(id, env ? { ...process.env, ...env } : process.env, {
			onDebug: (m) => this.logger.debug(m),
		});

	/**
	 * A run's level where the request named none (#673 w21): an alert-started
	 * run Auto (#818); any other run Settings, then the agent's own default, then PrismaLens's.
	 */
	async effectiveChoice(
		id: HarnessId,
		autoStart = false,
	): Promise<{ accessLevel: AccessLevel }> {
		const settings = await this.getSettings();
		const local = this.localDefaultOf(id, (await this.runtimeFor(id)).env);
		return {
			accessLevel: effectiveAccess(settings, id, local.permission, autoStart)
				.level,
		};
	}

	/** A mode's name as the agent's last check listed it; the id when it listed none (#673 w21). */
	modeName(harness: string | null, modeId: string | null): string | null {
		if (!modeId) return null;
		const id = HARNESS_IDS.find((h) => h === harness);
		const listed = id ? this.models.checked(id)?.modes : null;
		return listed?.find((m) => m.id === modeId)?.name ?? modeId;
	}

	/** Whether boot resumes the runs a restart cut off (#981); on unless turned off. */
	async resumeAfterRestart(): Promise<boolean> {
		return (await this.getSettings()).resumeAfterRestart !== false;
	}

	async getSettings(): Promise<HarnessSettings> {
		const row = await this.prisma.setting.findUnique({
			where: { key: SETTING_KEY },
		});
		return this.withEnvNames(this.parseSettings(row?.value));
	}

	private async withEnvNames(read: HarnessSettings): Promise<HarnessSettings> {
		const { envNames: _, ...rest } = read;
		const epoch = this.cacheEpoch;
		const envNames = Object.fromEntries(
			Object.entries(await this.readEnv()).map(([id, rows]) => [
				id,
				Object.keys(rows).sort(),
			]),
		);
		const settings: HarnessSettings = {
			...rest,
			...nonEmpty("envNames", envNames),
		};
		if (epoch === this.cacheEpoch) this.lastSettings = settings;
		return settings;
	}

	private parseSettings(value: string | undefined): HarnessSettings {
		if (value === undefined) return { harness: "auto" };
		try {
			const parsed = JSON.parse(value) as Partial<HarnessSettings>;
			const harness =
				parsed.harness === "auto" ||
				HARNESS_IDS.includes(parsed.harness as HarnessId)
					? (parsed.harness as HarnessSettings["harness"])
					: "auto";
			const models = cleanModels(parsed.models);
			const efforts = cleanModels(parsed.efforts);
			const favourites = cleanFavourites(parsed.favourites);
			const customModels = cleanCustomModels(parsed.customModels);
			const localAgent = cleanLocalAgent(parsed.localAgent);
			const off = cleanIds(parsed.off);
			const added = cleanIds(parsed.added);
			// A stored `agentModes` (before the two axes) is not read back (#673 w21).
			return {
				harness,
				...(off.length ? { off } : {}),
				...(added.length ? { added } : {}),
				...(Object.keys(models).length ? { models } : {}),
				...(favourites.length ? { favourites } : {}),
				...(Object.keys(efforts).length ? { efforts } : {}),
				...cleanAxes(parsed),
				...(Object.keys(customModels).length ? { customModels } : {}),
				...nonEmpty("hiddenModels", cleanLists(parsed.hiddenModels)),
				...nonEmpty("modelOrder", cleanLists(parsed.modelOrder)),
				...nonEmpty("binaryPaths", cleanModels(parsed.binaryPaths)),
				...nonEmpty("configDirs", cleanModels(parsed.configDirs)),
				...(localAgent ? { localAgent } : {}),
				...(parsed.strictEnv === true ? { strictEnv: true } : {}),
				...(parsed.unattendedGithub === true ? { unattendedGithub: true } : {}),
				...(parsed.alertAsks === "wait" ? { alertAsks: "wait" as const } : {}),
				...(parsed.resumeAfterRestart === false
					? { resumeAfterRestart: false }
					: {}),
				...sessionRows(parsed),
				...subagentLimitFields(
					parsed.subagentDepth,
					parsed.subagentConcurrency,
				),
				...(parsed.subagentsOnStop === "finish"
					? { subagentsOnStop: "finish" as const }
					: {}),
				...nonEmpty("useDefaults", cleanUseDefaults(parsed.useDefaults)),
				...nonEmpty("threadTitles", cleanThreadTitles(parsed.threadTitles)),
			};
		} catch {
			return { harness: "auto" };
		}
	}

	/**
	 * `host`: the caller holds `admin:access`. Only then may it change what an
	 * agent runs, else a paired phone could pick the program (#907 decision 11).
	 */
	async updateSettings(
		patch: HarnessSettingsPatch,
		opts: { host: boolean } = { host: true },
	): Promise<HarnessSettings> {
		const touched = RUNTIME_FIELDS.filter((f) => patch[f] !== undefined);
		if (touched.length && !opts.host)
			throw new HarnessSettingsError(RUNTIME_HOST_ONLY, "FORBIDDEN");
		const current = await this.getSettings();
		const binaryPaths = mergeRuntime(
			current.binaryPaths,
			patch.binaryPaths,
			(_, raw) => programPath(raw),
		);
		const configDirs = mergeRuntime(
			current.configDirs,
			patch.configDirs,
			(id, raw) => {
				const row = HARNESS_REGISTRY[id];
				if (!row.configDir)
					throw new HarnessSettingsError(
						`${row.label} has no config directory setting.`,
					);
				return folderPath(raw);
			},
		);
		const localAgent =
			patch.localAgent === undefined
				? current.localAgent
				: patch.localAgent === null
					? undefined
					: {
							command: programPath(patch.localAgent.command),
							args: patch.localAgent.args,
						};
		const envValue = patch.env ? await this.envValue(patch.env) : undefined;
		const models = cleanModels({ ...current.models, ...patch.models });
		const favourites = cleanFavourites(patch.favourites ?? current.favourites);
		const efforts = cleanModels({ ...current.efforts, ...patch.efforts });
		const axes = cleanAxes(
			Object.fromEntries(
				AXES.map((axis) => [axis, { ...current[axis], ...patch[axis] }]),
			),
		);
		const customModels = cleanCustomModels({
			...current.customModels,
			...patch.customModels,
		});
		const hiddenModels = cleanLists({
			...current.hiddenModels,
			...patch.hiddenModels,
		});
		const modelOrder = cleanLists({
			...current.modelOrder,
			...patch.modelOrder,
		});
		const off = mergeIds(current.off, patch.off);
		const added = mergeIds(current.added, patch.added);
		const turnedOff = off.filter((id) => !current.off?.includes(id));
		const turnedOn = (current.off ?? []).filter((id) => !off.includes(id));
		const harness = patch.harness ?? current.harness;
		// Off clears what would pick it for a new run; its other settings stay (#1171).
		const useDefaults = cleanUseDefaults({
			...current.useDefaults,
			...patch.useDefaults,
		});
		for (const use of MODEL_USES) {
			const named = useDefaults[use]?.harness;
			if (named && turnedOff.includes(named)) delete useDefaults[use];
		}
		const next: HarnessSettings = {
			harness:
				harness !== "auto" && turnedOff.includes(harness) ? "auto" : harness,
			...(off.length ? { off } : {}),
			...(added.length ? { added } : {}),
			...(Object.keys(models).length ? { models } : {}),
			...(favourites.length ? { favourites } : {}),
			...(Object.keys(efforts).length ? { efforts } : {}),
			...axes,
			...(Object.keys(customModels).length ? { customModels } : {}),
			...nonEmpty("hiddenModels", hiddenModels),
			...nonEmpty("modelOrder", modelOrder),
			...nonEmpty("binaryPaths", binaryPaths),
			...nonEmpty("configDirs", configDirs),
			...(localAgent ? { localAgent } : {}),
			...((patch.strictEnv ?? current.strictEnv) ? { strictEnv: true } : {}),
			...((patch.unattendedGithub ?? current.unattendedGithub)
				? { unattendedGithub: true }
				: {}),
			...((patch.alertAsks ?? current.alertAsks) === "wait"
				? { alertAsks: "wait" as const }
				: {}),
			...((patch.resumeAfterRestart ?? current.resumeAfterRestart) === false
				? { resumeAfterRestart: false }
				: {}),
			...sessionRows({
				coldResume: patch.coldResume ?? current.coldResume,
				coldResumeTokens: patch.coldResumeTokens ?? current.coldResumeTokens,
				resumeAfterLimit: patch.resumeAfterLimit ?? current.resumeAfterLimit,
				compactIdle: patch.compactIdle ?? current.compactIdle,
			}),
			...subagentLimitFields(
				patch.subagentDepth === undefined
					? current.subagentDepth
					: patch.subagentDepth,
				patch.subagentConcurrency === undefined
					? current.subagentConcurrency
					: patch.subagentConcurrency,
			),
			...((patch.subagentsOnStop ?? current.subagentsOnStop) === "finish"
				? { subagentsOnStop: "finish" as const }
				: {}),
			...nonEmpty("useDefaults", useDefaults),
			...nonEmpty(
				"threadTitles",
				cleanThreadTitles(
					patch.threadTitles === undefined
						? current.threadTitles
						: (patch.threadTitles ?? {}),
				),
			),
		};
		// The variables and the rest of the PATCH land together or not at all (#911).
		await this.prisma.$transaction(async (tx) => {
			if (envValue !== undefined)
				await tx.setting.upsert({
					where: { key: ENV_KEY },
					update: { value: envValue, type: "encrypted" },
					create: {
						key: ENV_KEY,
						value: envValue,
						type: "encrypted",
						category: "ai",
					},
				});
			await tx.setting.upsert({
				where: { key: SETTING_KEY },
				update: { value: JSON.stringify(next), type: "json" },
				create: {
					key: SETTING_KEY,
					value: JSON.stringify(next),
					type: "json",
					category: "ai",
				},
			});
		});
		const changed = new Set<HarnessId>([
			// The floor reaches every installed agent's env.
			...(patch.strictEnv !== undefined &&
			patch.strictEnv !== (current.strictEnv === true)
				? listHarnessStatus(this.selectionInput(next))
						.filter((h) => h.installed)
						.map((h) => h.id as HarnessId)
				: []),
			...(Object.keys(patch.binaryPaths ?? {}) as HarnessId[]),
			...(Object.keys(patch.configDirs ?? {}) as HarnessId[]),
			...(Object.keys(patch.env ?? {}) as HarnessId[]),
			...(patch.localAgent !== undefined ? (["local"] as const) : []),
		]);
		// Reads begun before the commit are stale from here on and cannot write the cache.
		this.cacheEpoch += 1;
		// The list, the picker and the run gate describe what the next run uses (#907 decision 13).
		const settings = await this.withEnvNames(next);
		for (const id of changed) {
			this.models.forget(id);
			this.inFlight.delete(id);
			void this.checkOnce(id);
		}
		if (changed.size) void this.persistChecks();
		for (const id of turnedOn) if (!changed.has(id)) void this.checkOnce(id);
		return settings;
	}

	/** Validates every name and value, then returns the stored JSON with the ciphertext; a refusal saves nothing. */
	private async envValue(
		patch: NonNullable<HarnessSettingsPatch["env"]>,
	): Promise<string> {
		const credentials = this.credentials;
		if (!credentials)
			throw new HarnessSettingsError("Agent variables can't be stored here.");
		const stored = await this.readEnv();
		for (const [id, rows] of Object.entries(patch) as [
			HarnessId,
			Record<string, string | null> | undefined,
		][]) {
			if (!rows) continue;
			const next = { ...stored[id] };
			for (const [name, value] of Object.entries(rows)) {
				if (value === null) {
					delete next[name];
					continue;
				}
				const refused = refuseEnvName(id, name);
				if (refused) throw new HarnessSettingsError(refused);
				// An empty value would override a working host value; Remove is how to clear one (#911).
				if (value === "")
					throw new HarnessSettingsError(
						`${name} needs a value. Remove clears it.`,
					);
				if (name === "ANTHROPIC_BASE_URL" && !isSafeGatewayUrl(value))
					throw new HarnessSettingsError(
						`ANTHROPIC_BASE_URL must be https unless it points at this machine: ${value}`,
					);
				next[name] = credentials.encryptToBase64(value);
			}
			if (Object.keys(next).length > MAX_ENV_NAMES)
				throw new HarnessSettingsError("An agent takes at most 50 variables.");
			if (Object.keys(next).length) stored[id] = next;
			else delete stored[id];
		}
		return JSON.stringify(stored);
	}

	/**
	 * Env pin first, then the run's own agent, then the persisted pin, then auto.
	 * A selection whose harness cannot take its model is not runnable (#639 rec 4).
	 */
	async resolveSelection(
		requested: Pick<RunChoice, "harness" | "model"> = {},
	): Promise<HarnessSelection> {
		const settings = await this.getSettings();
		const env = process.env.PRISMALENS_HARNESS?.trim();
		const asked = requested.harness;
		const input = this.selectionInput(settings);
		// Off refuses every new turn on it, follow-ups included; only PRISMALENS_HARNESS wins (#1171 §11).
		const chosen =
			asked ?? (settings.harness === "auto" ? null : settings.harness);
		if (!env && chosen && settings.off?.includes(chosen))
			return {
				runnable: false,
				failure: "agent-off",
				reason: this.offMessage(chosen),
				harness: chosen,
				...(asked ? {} : { pinnedBy: "settings" as const }),
			};
		const selection = env
			? resolveHarnessSelection({
					...input,
					envHarness: env,
					pinSource: "env",
				})
			: asked
				? this.askedSelection(asked, input)
				: resolveHarnessSelection(
						settings.harness === "auto"
							? input
							: {
									...input,
									envHarness: settings.harness,
									pinSource: "settings",
								},
					);
		if (env && asked && selection.runnable && selection.harness !== asked)
			return {
				runnable: false,
				failure: "env-pinned-other",
				reason: `PRISMALENS_HARNESS="${env}" decides which agent runs on this machine; unset it to run ${HARNESS_REGISTRY[asked].label}.`,
				harness: asked,
				pinnedBy: "env",
			};
		if (!selection.runnable) return selection;
		const reason = refuseModel(
			selection.harness,
			requested.model !== undefined
				? (requested.model ?? undefined)
				: settings.models?.[selection.harness],
		);
		if (!reason) return selection;
		return {
			runnable: false,
			failure: "model-unsupported",
			reason,
			harness: selection.harness,
			...(selection.pinnedBy ? { pinnedBy: selection.pinnedBy } : {}),
		};
	}

	/** The agent's own login with its Settings binary path and config folder; null when it has none. */
	private signInOf(id: HarnessId, s: HarnessSettings): HarnessStatus["signIn"] {
		const row = HARNESS_REGISTRY[id];
		// A stored value moves where it logs in, and stored values are never shown; Windows ignores case (#1171).
		const stored = new Set(s.envNames?.[id]?.map((n) => n.toUpperCase()));
		if (row.loginEnvKeys?.some((k) => stored.has(k.toUpperCase()))) return null;
		const command = signInCommand(row, {
			...(s.binaryPaths?.[id] ? { binaryPath: s.binaryPaths[id] } : {}),
			...(s.configDirs?.[id] ? { configDir: s.configDirs[id] } : {}),
			platform: process.platform,
		});
		return command ? { command } : null;
	}

	/** The last readiness check's verdict for this agent; null when none has run. */
	checkedOutcome(id: HarnessId): HarnessProbeOutcome | null {
		return this.models.checked(id)?.outcome ?? null;
	}

	/** The agent a run's own chip named: on PATH, or refused in the run's words. */
	private askedSelection(
		id: HarnessId,
		input: HarnessSelectionInput,
	): HarnessSelection {
		const row = HARNESS_REGISTRY[id];
		const found = resolveHarnessSelection({ ...input, envHarness: id });
		return found.runnable
			? { runnable: true, harness: id, auto: false }
			: {
					runnable: false,
					failure: found.failure,
					reason: `${row.label} is not on this machine. Install: ${row.install}`,
					harness: id,
				};
	}

	async getStatus(): Promise<HarnessesResponse> {
		const selection = await this.resolveSelection();
		const settings = await this.getSettings();
		const stored = await this.readEnv();
		const runtimes = new Map(
			HARNESS_IDS.map((id) => [id, this.listedRuntime(id, settings, stored)]),
		);
		const catalogue = this.models.catalogue();
		return {
			harnesses: listHarnessStatus({
				...this.selectionInput(settings),
				envFor: (id) => ({ ...process.env, ...runtimes.get(id)?.env }),
			}).map((h) => {
				const off = settings.off?.includes(h.id) ?? false;
				const checked = this.models.checked(h.id);
				return {
					...h,
					runnable: h.installed && !off && this.checkPasses(h.id),
					providerSignIn: providerSignIn(
						h.id,
						checked,
						settings.models?.[h.id] ?? this.runModelOf(h.id),
					),
					off,
					added: settings.added?.includes(h.id) ?? false,
					signIn: this.signInOf(h.id, settings),
					versionVsTested: testedPair(checked, h.tested),
					localDefault: this.localDefaultOf(h.id, runtimes.get(h.id)?.env),
					envVars: envVarStates(h.id, settings.envNames?.[h.id] ?? []),
					models: this.models.modelsFor(h.id, catalogue),
					checked,
				};
			}),
			selection: selection.runnable
				? {
						runnable: true,
						harness: selection.harness,
						pinned: !selection.auto,
						pinnedBy: selection.pinnedBy ?? null,
						blockedReason: null,
					}
				: {
						runnable: false,
						harness: selection.harness ?? null,
						// A pin failure (env or persisted) is pinned; only "no-harness" is auto.
						pinned: selection.failure !== "no-harness",
						pinnedBy: selection.pinnedBy ?? null,
						blockedReason: selection.reason,
					},
		};
	}
}

/** The version a check read against the tested one, paired as Settings shows them (#818). */
function testedPair(
	checked: HarnessStatus["checked"],
	tested: HarnessStatus["tested"],
): HarnessStatus["versionVsTested"] {
	const cli = checked?.companionVersion ?? null;
	const ran = cli ?? checked?.version ?? null;
	return versionVsTested(ran, cli ? tested?.companion : tested?.version);
}

/** The session rows (#1024), each kept only when it differs from its default. */
function sessionRows(
	from: Partial<HarnessSettings>,
): Pick<
	HarnessSettings,
	"coldResume" | "coldResumeTokens" | "resumeAfterLimit" | "compactIdle"
> {
	const tokens = from.coldResumeTokens;
	return {
		...(from.coldResume === "compact" || from.coldResume === "send"
			? { coldResume: from.coldResume }
			: {}),
		...(typeof tokens === "number" &&
		Number.isInteger(tokens) &&
		tokens >= 0 &&
		tokens !== COLD_RESUME_TOKENS
			? { coldResumeTokens: tokens }
			: {}),
		...(from.resumeAfterLimit === false ? { resumeAfterLimit: false } : {}),
		...(from.compactIdle === true ? { compactIdle: true } : {}),
	};
}
