// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The run's MCP server name is reserved (#1101): a server of the user's own by that name is reported. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PL_SERVER_NAME } from "@prismalens/contracts/schemas";
import { parse as parseToml } from "smol-toml";
import { readJsonc } from "./local-default.js";

type Read = (path: string) => Record<string, unknown> | null;

const readToml: Read = (path) => {
	try {
		return parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
};

const child = (v: unknown, key: string): unknown =>
	v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;

/** Where each agent keeps its own MCP servers, and the key that holds them. */
function sources(
	harness: string,
	env: NodeJS.ProcessEnv,
	cwd: string,
): {
	path: string;
	servers: (c: Record<string, unknown>) => unknown[];
	toml?: true;
}[] {
	const home = env.HOME ?? env.USERPROFILE ?? homedir();
	const mcpServers = (c: Record<string, unknown>) => [c.mcpServers];
	switch (harness) {
		case "claude-code":
			return [
				{
					path: join(home, ".claude.json"),
					servers: (c) => [
						c.mcpServers,
						child(child(c.projects, cwd), "mcpServers"),
					],
				},
				{ path: join(cwd, ".mcp.json"), servers: mcpServers },
			];
		case "codex":
			return [
				{
					path: join(env.CODEX_HOME || join(home, ".codex"), "config.toml"),
					servers: (c) => [c.mcp_servers],
					toml: true,
				},
			];
		case "gemini":
			return [
				{ path: join(home, ".gemini", "settings.json"), servers: mcpServers },
				{ path: join(cwd, ".gemini", "settings.json"), servers: mcpServers },
			];
		case "opencode": {
			const dir = join(
				env.XDG_CONFIG_HOME || join(home, ".config"),
				"opencode",
			);
			return ["opencode.json", "opencode.jsonc", "config.json"]
				.map((f) => join(dir, f))
				.concat(join(cwd, "opencode.json"), join(cwd, "opencode.jsonc"))
				.map((path) => ({ path, servers: (c) => [c.mcp] }));
		}
		default:
			return [];
	}
}

/** The first of the agent's own config files that defines a `prismalens` MCP server, or null. */
export function userServerByOurName(
	harness: string,
	env: NodeJS.ProcessEnv,
	cwd: string,
	read: { json: Read; toml: Read } = {
		json: (p) => readJsonc(p),
		toml: readToml,
	},
): string | null {
	for (const s of sources(harness, env, cwd)) {
		const config = (s.toml ? read.toml : read.json)(s.path);
		if (
			config &&
			s.servers(config).some((m) => child(m, PL_SERVER_NAME) !== undefined)
		)
			return s.path;
	}
	return null;
}
