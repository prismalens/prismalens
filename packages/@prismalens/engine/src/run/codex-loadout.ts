// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What Codex itself says it loads, for What loads (#1180 §3.1): `config/read` (the user and
 * project layers only, never the `sessionFlags` layer the overrides form), `skills/list`,
 * `hooks/list` and `plugin/installed`, on an app-server that starts no thread. Each found
 * MCP server is off by name; hooks and plugins stay on, since with them off Codex 0.171.0
 * lists none.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	codexMcpOffArgs,
	killProcessTree,
	type LaunchPolicy,
	spawnAgent,
} from "@prismalens/agent-host";
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type { LoadedItem } from "@prismalens/contracts/schemas";
import {
	type CodexAppServerPlan,
	withCodexAppServer,
} from "./codex-app-server.js";
import { removeRunDir } from "./harness-doctor.js";
import { prepareRunEnv } from "./investigate.js";

export const CODEX_LOADOUT_BUDGET_MS = 15_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * The MCP servers Codex loads in `plan.cwd`, by `mcp list --json`, which starts none. Codex's own
 * trust rules pick the project layers, and naming a server of an unloaded layer in an override
 * stops it at start (`invalid transport`, 0.171.0). Null when it gave no list in `budgetMs`.
 */
export async function codexLoadedMcp(
	plan: CodexAppServerPlan,
	budgetMs: number,
): Promise<string[] | null> {
	const child = spawnAgent({
		command: plan.command,
		args: [...(plan.args ?? []), "mcp", "list", "--json"],
		cwd: plan.cwd,
		env: plan.env,
	});
	let out = "";
	child.stdout.setEncoding("utf8").on("data", (d: string) => {
		out += d;
	});
	child.stderr.resume();
	child.stdin.end();
	let timer: NodeJS.Timeout | undefined;
	const code = await Promise.race([
		new Promise<number | null>((r) => {
			child.once("error", () => r(null));
			child.once("close", (c) => r(c));
		}),
		new Promise<null>((r) => {
			timer = setTimeout(() => r(null), budgetMs);
		}),
	]);
	clearTimeout(timer);
	if (code !== 0) {
		killProcessTree(child);
		return null;
	}
	try {
		const list: unknown = JSON.parse(out);
		return Array.isArray(list)
			? list.flatMap((s) =>
					isRecord(s) && str(s.name) ? [String(s.name)] : [],
				)
			: null;
	} catch {
		return null;
	}
}

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const STATE_RANK: LoadedItem["state"][] = ["off", "untrusted", "loads"];

const HOOK_SCOPES: Record<string, LoadedItem["scope"]> = {
	user: "global",
	project: "repo",
	plugin: "plugin",
	unknown: "global",
};

/** The answers of one app-server as What loads rows, each marked reported `at`. */
export function codexItems(
	answers: {
		config?: unknown;
		skills?: unknown;
		hooks?: unknown;
		plugins?: unknown;
	},
	at: string,
): LoadedItem[] {
	const out: LoadedItem[] = [];
	const row = (
		kind: LoadedItem["kind"],
		name: string,
		scope: LoadedItem["scope"],
		path: string | null,
		state: LoadedItem["state"],
		extra: Partial<LoadedItem> = {},
	) =>
		out.push({
			kind,
			name: name.slice(0, 200),
			scope,
			path: path ? resolve(path).slice(0, 1024) : null,
			disk: true,
			reported: at,
			state,
			...extra,
		});
	const layers = isRecord(answers.config) ? answers.config.layers : null;
	for (const layer of Array.isArray(layers) ? layers : []) {
		if (!isRecord(layer) || !isRecord(layer.name) || !isRecord(layer.config))
			continue;
		const type = layer.name.type;
		if (type !== "user" && type !== "project") continue;
		const path =
			type === "user"
				? str(layer.name.file)
				: str(layer.name.dotCodexFolder)
					? join(String(layer.name.dotCodexFolder), "config.toml")
					: null;
		const untrusted = !!str(layer.disabledReason);
		const scope = type === "user" ? "global" : "repo";
		const servers = layer.config.mcp_servers;
		for (const [name, def] of Object.entries(isRecord(servers) ? servers : {}))
			row(
				"mcp",
				name,
				scope,
				path,
				untrusted
					? "untrusted"
					: isRecord(def) && def.enabled === false
						? "off"
						: "loads",
				isRecord(def) ? { transport: "url" in def ? "http" : "stdio" } : {},
			);
	}
	const skills = isRecord(answers.skills) ? answers.skills.data : null;
	for (const entry of Array.isArray(skills) ? skills : [])
		for (const s of isRecord(entry) && Array.isArray(entry.skills)
			? entry.skills
			: []) {
			if (!isRecord(s) || !str(s.name)) continue;
			const scope: LoadedItem["scope"] = str(s.pluginId)
				? "plugin"
				: s.scope === "user"
					? "global"
					: s.scope === "repo"
						? "repo"
						: "managed";
			row(
				"skill",
				String(s.name),
				scope,
				str(s.path),
				s.enabled === false ? "off" : "loads",
			);
		}
	const hooks = isRecord(answers.hooks) ? answers.hooks.data : null;
	for (const entry of Array.isArray(hooks) ? hooks : [])
		for (const h of isRecord(entry) && Array.isArray(entry.hooks)
			? entry.hooks
			: []) {
			if (!isRecord(h) || !str(h.eventName) || h.source === "sessionFlags")
				continue;
			row(
				"hook",
				pascal(String(h.eventName)),
				HOOK_SCOPES[String(h.source)] ?? "managed",
				str(h.sourcePath),
				h.enabled === false
					? "off"
					: h.trustStatus === "untrusted" || h.trustStatus === "modified"
						? "untrusted"
						: "loads",
			);
		}
	const markets = isRecord(answers.plugins)
		? answers.plugins.marketplaces
		: null;
	for (const m of Array.isArray(markets) ? markets : [])
		for (const p of isRecord(m) && Array.isArray(m.plugins) ? m.plugins : []) {
			if (!isRecord(p) || !str(p.id) || p.installed !== true) continue;
			row(
				"plugin",
				String(p.id),
				"global",
				null,
				p.enabled === false ? "off" : "loads",
			);
		}
	// Handlers of one event in one file share a row: it loads if any of them does.
	const rank = (i: LoadedItem) => STATE_RANK.indexOf(i.state);
	const rows = new Map<string, LoadedItem>();
	for (const i of out) {
		const k = `${i.kind}\0${i.name}\0${i.scope}\0${i.path ?? ""}`;
		const had = rows.get(k);
		if (!had || rank(i) > rank(had))
			rows.set(k, had ? { ...had, state: i.state } : i);
	}
	return [...rows.values()].slice(0, 500);
}

/** What Codex reports loading for `repoRoot` (or no project); null when the CLI gave no answer. */
export async function readCodexLoadout(
	plan: CodexAppServerPlan,
	repoRoot: string | null,
	o: { home: string; budgetMs?: number; now?: () => Date },
): Promise<LoadedItem[] | null> {
	const cwds = [repoRoot ?? plan.cwd];
	const at = { ...plan, cwd: repoRoot ?? plan.cwd };
	const budget = o.budgetMs ?? CODEX_LOADOUT_BUDGET_MS;
	const loaded = await codexLoadedMcp(at, budget);
	if (!loaded) return null;
	const answers = await withCodexAppServer(
		at,
		codexMcpOffArgs(loaded),
		budget,
		async (call) => {
			const ask = (method: string, params: unknown) =>
				call(method, params).catch(() => undefined);
			return {
				config: await ask("config/read", {
					...(repoRoot ? { cwd: repoRoot } : {}),
					includeLayers: true,
				}),
				skills: await ask("skills/list", { cwds }),
				hooks: await ask("hooks/list", { cwds }),
				plugins: await ask("plugin/installed", { cwds }),
			};
		},
	);
	return answers
		? codexItems(answers, (o.now?.() ?? new Date()).toISOString())
		: null;
}

/**
 * What the agent reports loading before any run, through its own CLI in a scratch folder; null
 * for an agent with no such read, or when its CLI is not found or gave no answer.
 */
export async function readAgentLoadout(
	agent: HarnessId,
	runtime: {
		env?: Record<string, string>;
		policy?: LaunchPolicy;
		binaryPath?: string;
	},
	repoRoot: string | null,
	o: { budgetMs?: number; now?: () => Date } = {},
): Promise<LoadedItem[] | null> {
	if (HARNESS_REGISTRY[agent]?.loadoutReport !== "codex-app-server")
		return null;
	const runDir = mkdtempSync(join(tmpdir(), `pl-loadout-${Date.now()}-`));
	const cwd = join(runDir, "workspace");
	mkdirSync(cwd, { recursive: true });
	try {
		const { env, runEnv } = prepareRunEnv({
			harness: agent,
			cwd,
			runDir,
			env: runtime.env ?? {},
			...(runtime.policy ? { policy: runtime.policy } : {}),
			...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
		});
		if (!runEnv.companionPath) return null;
		return await readCodexLoadout(
			{ command: runEnv.companionPath, env, cwd },
			repoRoot,
			{ home: env.HOME || env.USERPROFILE || homedir(), ...o },
		);
	} finally {
		removeRunDir(runDir);
	}
}
