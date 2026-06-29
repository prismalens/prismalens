/**
 * Config loader (salvaged from the retired pl orchestrator, ADR-0010).
 *
 * Resolution order (later overrides earlier):
 *  1. Built-in defaults (Zod `.default()`)
 *  2. Global layer: ~/.prismalens/{prismalens,pl}.config.yaml  (BYO-key creds, ADR-0006)
 *  3. Project layer: the explicit `--config` path, else the nearest config file
 *     found by walking UP from cwd to the filesystem root
 *  4. CLI flag overrides
 *
 * `${VAR}` patterns in string values are interpolated from the environment
 * (throws on an unset var), then the merged object is validated by the schema.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { type PlConfig, PlConfigSchema } from "./schema.js";

const CONFIG_FILENAMES = ["prismalens.config.yaml", "pl.config.yaml"];

export interface CliOverrides {
	/** agent.default — harness backend. */
	agent?: string;
	/** agent.model. */
	model?: string;
	/** agent.timeout_ms + budget.timeout_ms (ms). */
	timeout?: number;
	/** budget.tokens. */
	budgetTokens?: number;
	/** budget.max_concurrent_sub_agents. */
	maxAgents?: number;
	/** logging.level = "debug". */
	verbose?: boolean;
	prometheusUrl?: string;
	alertmanagerUrl?: string;
	apiUrl?: string;
}

export interface LoadConfigOptions {
	/** Explicit config path (`--config`). Skips the upward search. */
	configPath?: string;
	/** Directory to start the upward search from. Default `process.cwd()`. */
	cwd?: string;
	cliOverrides?: CliOverrides;
}

/** Find the nearest config file by walking up from `cwd` to the filesystem root. */
export function findConfigFile(
	cwd: string = process.cwd(),
): string | undefined {
	let dir = resolve(cwd);
	const { root } = parsePath(dir);
	for (;;) {
		for (const name of CONFIG_FILENAMES) {
			const candidate = join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
		if (dir === root) return undefined;
		dir = dirname(dir);
	}
}

/** The global config file under ~/.prismalens, if present. */
function globalConfigFile(): string | undefined {
	for (const name of CONFIG_FILENAMES) {
		const candidate = join(homedir(), ".prismalens", name);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

async function readYamlFile(
	filePath: string,
): Promise<Record<string, unknown>> {
	try {
		const content = await readFile(filePath, "utf-8");
		return (parseYaml(content) as Record<string, unknown>) ?? {};
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}
}

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/** Replace `${VAR}` in every string value (recursively). Throws on an unset var. */
function interpolateDeep(value: unknown): unknown {
	if (typeof value === "string") {
		return value.replace(ENV_VAR_PATTERN, (_, name: string) => {
			const v = process.env[name];
			if (v === undefined) {
				throw new Error(
					`Config references unset environment variable "${name}" (as \${${name}})`,
				);
			}
			return v;
		});
	}
	if (Array.isArray(value)) return value.map(interpolateDeep);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = interpolateDeep(v);
		return out;
	}
	return value;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge `source` over `target`. Arrays replace; objects merge recursively. */
function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const out = { ...target };
	for (const [k, sv] of Object.entries(source)) {
		const tv = out[k];
		out[k] = isObject(sv) && isObject(tv) ? deepMerge(tv, sv) : sv;
	}
	return out;
}

function applyCliOverrides(
	config: Record<string, unknown>,
	o: CliOverrides,
): Record<string, unknown> {
	const patch: Record<string, unknown> = {};

	const agent: Record<string, unknown> = {};
	if (o.agent !== undefined) agent.default = o.agent;
	if (o.model !== undefined) agent.model = o.model;
	if (o.timeout !== undefined) agent.timeout_ms = o.timeout;
	if (Object.keys(agent).length > 0) patch.agent = agent;

	const budget: Record<string, unknown> = {};
	if (o.budgetTokens !== undefined) budget.tokens = o.budgetTokens;
	if (o.maxAgents !== undefined) budget.max_concurrent_sub_agents = o.maxAgents;
	if (o.timeout !== undefined) budget.timeout_ms = o.timeout;
	if (Object.keys(budget).length > 0) patch.budget = budget;

	const telemetry: Record<string, unknown> = {};
	if (o.prometheusUrl !== undefined) telemetry.prometheusUrl = o.prometheusUrl;
	if (o.alertmanagerUrl !== undefined)
		telemetry.alertmanagerUrl = o.alertmanagerUrl;
	if (o.apiUrl !== undefined) telemetry.apiUrl = o.apiUrl;
	if (Object.keys(telemetry).length > 0) patch.telemetry = telemetry;

	if (o.verbose) patch.logging = { level: "debug" };

	return deepMerge(config, patch);
}

/** Load, merge, interpolate, and validate the config. Result is frozen. */
export async function loadConfig(
	options: LoadConfigOptions = {},
): Promise<PlConfig> {
	const cwd = options.cwd ?? process.cwd();

	const globalFile = globalConfigFile();
	const projectFile = options.configPath
		? resolve(options.configPath)
		: findConfigFile(cwd);

	let merged: Record<string, unknown> = {};
	if (globalFile) merged = deepMerge(merged, await readYamlFile(globalFile));
	if (projectFile) merged = deepMerge(merged, await readYamlFile(projectFile));

	if (options.cliOverrides) {
		merged = applyCliOverrides(merged, options.cliOverrides);
	}

	const interpolated = interpolateDeep(merged) as Record<string, unknown>;

	let config: PlConfig;
	try {
		config = PlConfigSchema.parse(interpolated);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid PrismaLens configuration: ${detail}`);
	}
	return Object.freeze(config);
}
