// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * @prismalens/config/harness-auth
 *
 * Node-side harness authentication resolver (ADR-0031).
 * Turns declared harness credential routes plus local evidence into a typed verdict.
 */
import { accessSync, existsSync, constants as fsConstants } from "node:fs";
import os from "node:os";
import { delimiter, join } from "node:path";
import {
	HARNESS_BINARY,
	HARNESS_REGISTRY,
	type HarnessId,
} from "./providers/harness.js";

/** Outcome of resolving authentication for a harness (ADR-0031). */
export type HarnessAuthVerdict =
	| { usable: true; route: "api-key" }
	| { usable: true; route: "cli-session"; verified: boolean }
	| { usable: false; reason: string };

export interface ResolveHarnessAuthOpts {
	apiKeyPresent: boolean;
	homeDir?: string;
	isOnPath?: (bin: string) => boolean;
}

/** Check whether a binary executable exists on PATH. */
export function isOnPath(bin: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	const exts =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const dir of pathEnv.split(delimiter)) {
		if (dir.length === 0) continue;
		for (const ext of exts) {
			try {
				accessSync(join(dir, bin + ext), fsConstants.X_OK);
				return true;
			} catch {
				// keep looking
			}
		}
	}
	return false;
}

/**
 * Resolve whether a harness has usable authentication on this machine (ADR-0031).
 * Walks declared auth routes in precedence order.
 */
export function resolveHarnessAuth(
	harnessId: HarnessId,
	opts: ResolveHarnessAuthOpts,
): HarnessAuthVerdict {
	const descriptor = HARNESS_REGISTRY[harnessId];
	if (!descriptor?.implemented) {
		return { usable: false, reason: `${harnessId} harness not implemented` };
	}

	const checkPath = opts.isOnPath ?? isOnPath;

	for (const route of descriptor.authRoutes) {
		if (route === "api-key") {
			if (opts.apiKeyPresent) {
				return { usable: true, route: "api-key" };
			}
		} else if (route === "cli-session") {
			if (harnessId === "claude-code") {
				const binary = HARNESS_BINARY["claude-code"];
				if (checkPath(binary)) {
					const configDir =
						process.env.CLAUDE_CONFIG_DIR ??
						join(opts.homeDir ?? os.homedir(), ".claude");
					const credPath = join(configDir, ".credentials.json");
					const verified = existsSync(credPath);
					return { usable: true, route: "cli-session", verified };
				}
			}
		}
	}

	if (harnessId === "claude-code") {
		return {
			usable: false,
			reason:
				"add an API key in Settings → AI provider, or sign in with the Claude CLI (claude /login)",
		};
	}

	return {
		usable: false,
		reason: "add an API key in Settings → AI provider",
	};
}
