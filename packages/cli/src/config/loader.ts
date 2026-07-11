// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Config loader (ADR-0010/0014).
 *
 * Resolution order (later overrides earlier — deep-merge; arrays replace):
 *  1. Built-in defaults (Zod `.default()`)
 *  2. User layer:    ~/.config/prismalens/config.yaml   (the XDG config dir; BYO-key
 *     creds live in env per ADR-0006, never here)
 *  3. Project layer: the explicit `--config` path, else the nearest
 *     `prismalens.config.yaml` found by walking UP from cwd to the root
 *  4. Project-local: `prismalens.config.local.yaml` beside the project config — a
 *     gitignored per-checkout override
 *  5. CLI flag overrides
 *
 * `${VAR}` patterns in string values are interpolated from the environment (throws
 * on an unset var), then the merged object is validated by the schema.
 *
 * Deferred ADR-0014 layers (pulled in with their consumers, not speculatively):
 *  - a curated env-overlay layer — today `${VAR}` interpolation already covers env
 *    access from within the config;
 *  - the reserved managed layer — there is no managed config source in the
 *    local-first OSS build (it belongs to the cloud tier);
 *  - the permission allow/deny list UNION (deny-wins) — coupled to the tool-seam
 *    that enforces it (its own slice), so it lands there, not in the merge.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import envPaths from "env-paths";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { type PlConfig, PlConfigSchema } from "./schema.js";

const PROJECT_CONFIG_FILENAME = "prismalens.config.yaml";
const PROJECT_LOCAL_CONFIG_FILENAME = "prismalens.config.local.yaml";
const USER_CONFIG_FILENAME = "config.yaml";

export interface CliOverrides {
	/** agent.default — harness backend. */
	agent?: string;
	/** agent.model. */
	model?: string;
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

/** Find the nearest project config by walking up from `cwd` to the filesystem root. */
export function findConfigFile(
	cwd: string = process.cwd(),
): string | undefined {
	let dir = resolve(cwd);
	const { root } = parsePath(dir);
	for (;;) {
		const candidate = join(dir, PROJECT_CONFIG_FILENAME);
		if (existsSync(candidate)) return candidate;
		if (dir === root) return undefined;
		dir = dirname(dir);
	}
}

/** The user-global config in the XDG config dir (~/.config/prismalens/config.yaml). */
function userConfigFile(): string | undefined {
	const candidate = join(
		envPaths("prismalens", { suffix: "" }).config,
		USER_CONFIG_FILENAME,
	);
	return existsSync(candidate) ? candidate : undefined;
}

/** The gitignored project-local override beside the project config (else in cwd). */
function projectLocalConfigFile(
	projectFile: string | undefined,
	cwd: string,
): string | undefined {
	const dir = projectFile ? dirname(projectFile) : resolve(cwd);
	const candidate = join(dir, PROJECT_LOCAL_CONFIG_FILENAME);
	return existsSync(candidate) ? candidate : undefined;
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
	if (Object.keys(agent).length > 0) patch.agent = agent;

	const telemetry: Record<string, unknown> = {};
	if (o.prometheusUrl !== undefined) telemetry.prometheusUrl = o.prometheusUrl;
	if (o.alertmanagerUrl !== undefined)
		telemetry.alertmanagerUrl = o.alertmanagerUrl;
	if (o.apiUrl !== undefined) telemetry.apiUrl = o.apiUrl;
	if (Object.keys(telemetry).length > 0) patch.telemetry = telemetry;

	return deepMerge(config, patch);
}

/** Load, merge, interpolate, and validate the config. Result is frozen. */
export async function loadConfig(
	options: LoadConfigOptions = {},
): Promise<PlConfig> {
	const cwd = options.cwd ?? process.cwd();

	if (options.configPath) {
		const resolvedPath = resolve(options.configPath);
		if (!existsSync(resolvedPath)) {
			throw new Error(`Configuration file not found: ${resolvedPath}`);
		}
	}

	const userFile = userConfigFile();
	const projectFile = options.configPath
		? resolve(options.configPath)
		: findConfigFile(cwd);
	const projectLocalFile = projectLocalConfigFile(projectFile, cwd);

	let merged: Record<string, unknown> = {};
	if (userFile) merged = deepMerge(merged, await readYamlFile(userFile));
	if (projectFile) merged = deepMerge(merged, await readYamlFile(projectFile));
	if (projectLocalFile && projectLocalFile !== projectFile) {
		merged = deepMerge(merged, await readYamlFile(projectLocalFile));
	}

	if (options.cliOverrides) {
		merged = applyCliOverrides(merged, options.cliOverrides);
	}

	const interpolated = interpolateDeep(merged) as Record<string, unknown>;

	let config: PlConfig;
	try {
		config = PlConfigSchema.parse(interpolated);
	} catch (err) {
		const failedFile =
			projectLocalFile && projectLocalFile !== projectFile
				? projectLocalFile
				: (projectFile ?? userFile ?? "config");
		if (err instanceof ZodError) {
			const issues = err.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join("\n");
			throw new Error(`Invalid configuration in ${failedFile}:\n${issues}`);
		}
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid PrismaLens configuration: ${detail}`);
	}
	return Object.freeze(config);
}
