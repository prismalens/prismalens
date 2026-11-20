// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { userServerByOurName } from "./reserved-name.js";

describe("userServerByOurName (#1101)", () => {
	const cwd = "/workspace/project";
	const home = "/home/user";
	const env = { HOME: home, USERPROFILE: home };

	it("finds reserved prismalens server in claude-code top-level mcpServers", () => {
		const configPath = join(home, ".claude.json");
		const read = {
			json: (path: string) => {
				if (path === configPath) {
					return {
						mcpServers: {
							prismalens: { command: "node", args: ["server.js"] },
						},
					};
				}
				return null;
			},
			toml: () => null,
		};
		const result = userServerByOurName("claude-code", env, cwd, read);
		expect(result).toBe(configPath);
	});

	it("finds reserved prismalens server in claude-code projects[cwd].mcpServers", () => {
		const configPath = join(home, ".claude.json");
		const read = {
			json: (path: string) => {
				if (path === configPath) {
					return {
						projects: {
							[cwd]: {
								mcpServers: {
									prismalens: { command: "node" },
								},
							},
						},
					};
				}
				return null;
			},
			toml: () => null,
		};
		const result = userServerByOurName("claude-code", env, cwd, read);
		expect(result).toBe(configPath);
	});

	it("finds reserved prismalens server in claude-code .mcp.json in cwd", () => {
		const mcpJsonPath = join(cwd, ".mcp.json");
		const read = {
			json: (path: string) => {
				if (path === mcpJsonPath) {
					return {
						mcpServers: {
							prismalens: { command: "node" },
						},
					};
				}
				return null;
			},
			toml: () => null,
		};
		const result = userServerByOurName("claude-code", env, cwd, read);
		expect(result).toBe(mcpJsonPath);
	});

	it("finds reserved prismalens server in codex config.toml mcp_servers", () => {
		const codexConfigPath = join(home, ".codex", "config.toml");
		const read = {
			json: () => null,
			toml: (path: string) => {
				if (path === codexConfigPath) {
					return {
						mcp_servers: {
							prismalens: { command: "python" },
						},
					};
				}
				return null;
			},
		};
		const result = userServerByOurName("codex", env, cwd, read);
		expect(result).toBe(codexConfigPath);
	});

	it("finds reserved prismalens server in gemini settings.json", () => {
		const geminiPath = join(cwd, ".gemini", "settings.json");
		const read = {
			json: (path: string) => {
				if (path === geminiPath) {
					return {
						mcpServers: {
							prismalens: { command: "gemini-mcp" },
						},
					};
				}
				return null;
			},
			toml: () => null,
		};
		const result = userServerByOurName("gemini", env, cwd, read);
		expect(result).toBe(geminiPath);
	});

	it("finds reserved prismalens server in opencode mcp key", () => {
		const opencodePath = join(cwd, "opencode.json");
		const read = {
			json: (path: string) => {
				if (path === opencodePath) {
					return {
						mcp: {
							prismalens: { command: "opencode-mcp" },
						},
					};
				}
				return null;
			},
			toml: () => null,
		};
		const result = userServerByOurName("opencode", env, cwd, read);
		expect(result).toBe(opencodePath);
	});

	it("returns null for unknown harness", () => {
		const read = {
			json: () => ({ mcpServers: { prismalens: {} } }),
			toml: () => ({ mcp_servers: { prismalens: {} } }),
		};
		const result = userServerByOurName("unknown-harness", env, cwd, read);
		expect(result).toBeNull();
	});

	it("returns null when cwd is undefined", () => {
		const read = {
			json: () => ({ mcpServers: { prismalens: {} } }),
			toml: () => ({ mcp_servers: { prismalens: {} } }),
		};
		const result = userServerByOurName("claude-code", env, undefined, read);
		expect(result).toBeNull();
	});

	it("returns null when a reader throws", () => {
		const read = {
			json: () => {
				throw new Error("Disk read error");
			},
			toml: () => {
				throw new Error("TOML parse error");
			},
		};
		const result = userServerByOurName("claude-code", env, cwd, read);
		expect(result).toBeNull();
	});
});
