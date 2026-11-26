// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The run's MCP server name is reserved (#1101): a server of the user's own by that name is reported. */
import { PL_SERVER_NAME } from "@prismalens/contracts/schemas";
import { type ConfigFs, nodeConfigFs, readOnDisk } from "./agent-config.js";

/** The first of the agent's own config files that defines a `prismalens` MCP server, or null. */
export function userServerByOurName(
	harness: string,
	env: Readonly<Record<string, string | undefined>>,
	cwd: string | undefined,
	fs: ConfigFs = nodeConfigFs,
): string | null {
	// A config PrismaLens cannot read never stops a run; it is only not reported.
	if (!cwd) return null;
	try {
		return (
			readOnDisk(harness, env, cwd, fs).find(
				(i) => i.kind === "mcp" && i.name === PL_SERVER_NAME,
			)?.path ?? null
		);
	} catch {
		return null;
	}
}
