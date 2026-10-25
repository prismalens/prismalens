// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9). The harness is the first registry row on
 * PATH, unless PRISMALENS_HARNESS or the persisted setting pins one.
 * Prismalens never bundles, installs or authenticates a harness.
 */
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	Optional,
} from "@nestjs/common";
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
	getHarnessProviderKeys,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	isSafeGatewayUrl,
	refuseModel,
	reservedEnvNames,
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
	effectiveAccess,
	type FavouriteModel,
	type HarnessesResponse,
	type HarnessProbeOutcome,
	type HarnessProbeResult,
	type HarnessStatus,
	type LocalAgent,
	type LocalDefault,
	RUNTIME_HOST_ONLY,
	type RunChoice,
	type RunRuntimeNote,
} from "@prismalens/contracts/schemas";
import { localDefault } from "@prismalens/engine";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HarnessModelsService } from "./harness-models.service.js";
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

/** What a spawn of one agent uses from Settings (#907): host keys < config dir < Environment rows. */
export interface AgentRuntime {
	env: Record<string, string>;
	binaryPath?: string;
	/** `local` only. */
	launchArgs?: string[];
	/** Recorded as `fidelity.runtime`; null when Settings set nothing for this agent. */
	note: RunRuntimeNote | null;
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
	/** Read from HARNESS_ENV: names only. */
	envNames?: Partial<Record<HarnessId, string[]>>;
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
}

const RUNTIME_FIELDS = [
	"binaryPaths",
	"configDirs",
	"env",
	"localAgent",
] as const satisfies readonly (keyof HarnessSettingsPatch)[];

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
	if (row.configDir?.envKey === name)
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
		void this.sweep();
	}

	async sweep(): Promise<void> {
		const settings = await this.getSettings();
		for (const h of listHarnessStatus(this.selectionInput(settings))) {
			if (h.installed) await this.checkOnce(h.id as HarnessId);
		}
	}

	/** What the launch probe needs from Settings, and auto's skip of a failed check (#907). */
	private selectionInput(s: HarnessSettings): HarnessSelectionInput {
		return {
			...(s.binaryPaths ? { binaryPaths: s.binaryPaths } : {}),
			localAgent: s.localAgent ?? null,
			isRunnable: (id) => this.checkPasses(id),
		};
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
			// Checked after the rows overlay the host: a saved https gateway fixes an unsafe host one (#911).
			...getHarnessProviderKeys(id, { ...process.env, ...rows }),
			...(configDir && row.configDir
				? { [row.configDir.envKey]: configDir }
				: {}),
			...rows,
		};
		const envNames = Object.keys(rows).sort();
		const args = local?.args ?? [];
		const set = !!binaryPath || !!configDir || envNames.length > 0;
		return {
			env,
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
		const row = await this.prisma.setting.findUnique({
			where: { key: ENV_KEY },
		});
		if (!row) return {};
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
			return out;
		} catch {
			return {};
		}
	}

	/** The Settings Check button: the handshake with this agent's runtime (#907). */
	async check(id: HarnessId): Promise<HarnessProbeResult> {
		return this.probe.check(id, await this.runtimeFor(id));
	}

	/**
	 * Would a run on this agent start? A remembered `answers-acp` under a day
	 * old, else a check now: a remembered failure is checked again, so signing
	 * in takes effect on the next run (#673 w9).
	 */
	async ensureReady(id: HarnessId): Promise<Readiness> {
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
		return check.outcome === "answers-acp"
			? { ready: true }
			: { ready: false, reason: notReadyReason(id, check) };
	}

	private checkOnce(id: HarnessId): Promise<Check | null> {
		const running = this.inFlight.get(id);
		if (running) return running;
		const next = this.runtimeFor(id)
			.then((runtime) => this.probe.check(id, runtime))
			.then(() => this.models.checked(id) ?? null)
			.catch((err: unknown) => {
				this.logger.warn(
					`Readiness check for ${id} failed: ${(err as Error).message}`,
				);
				return null;
			})
			.finally(() => this.inFlight.delete(id));
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

	async getSettings(): Promise<HarnessSettings> {
		const row = await this.prisma.setting.findUnique({
			where: { key: SETTING_KEY },
		});
		return this.withEnvNames(this.parseSettings(row?.value));
	}

	private async withEnvNames(read: HarnessSettings): Promise<HarnessSettings> {
		const { envNames: _, ...rest } = read;
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
		this.lastSettings = settings;
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
			// A stored `agentModes` (before the two axes) is not read back (#673 w21).
			return {
				harness,
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
		if (patch.env) await this.saveEnv(patch.env);
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
		const next: HarnessSettings = {
			harness: patch.harness ?? current.harness,
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
		};
		await this.prisma.setting.upsert({
			where: { key: SETTING_KEY },
			update: { value: JSON.stringify(next), type: "json" },
			create: {
				key: SETTING_KEY,
				value: JSON.stringify(next),
				type: "json",
				category: "ai",
			},
		});
		const changed = new Set<HarnessId>([
			...(Object.keys(patch.binaryPaths ?? {}) as HarnessId[]),
			...(Object.keys(patch.configDirs ?? {}) as HarnessId[]),
			...(Object.keys(patch.env ?? {}) as HarnessId[]),
			...(patch.localAgent !== undefined ? (["local"] as const) : []),
		]);
		// The list, the picker and the run gate describe what the next run uses (#907 decision 13).
		for (const id of changed) {
			this.models.forget(id);
			void this.checkOnce(id);
		}
		return this.withEnvNames(next);
	}

	/** Validates every name and value first, then writes the ciphertext; a refusal saves nothing. */
	private async saveEnv(
		patch: NonNullable<HarnessSettingsPatch["env"]>,
	): Promise<void> {
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
		const value = JSON.stringify(stored);
		await this.prisma.setting.upsert({
			where: { key: ENV_KEY },
			update: { value, type: "encrypted" },
			create: { key: ENV_KEY, value, type: "encrypted", category: "ai" },
		});
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
			}).map((h) => ({
				...h,
				runnable: h.installed && this.checkPasses(h.id),
				localDefault: this.localDefaultOf(h.id, runtimes.get(h.id)?.env),
				envVars: envVarStates(h.id, settings.envNames?.[h.id] ?? []),
				models: this.models.modelsFor(h.id, catalogue),
				checked: this.models.checked(h.id),
			})),
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
