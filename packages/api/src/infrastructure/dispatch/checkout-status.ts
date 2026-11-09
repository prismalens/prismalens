// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gitEnv } from "../../core/harness/git-env.js";

/** A private config and index keep status from executing checkout-defined filters or hooks (#1066). */
export function checkoutStatus(root: string): {
	env: Record<string, string>;
	close: () => void;
} {
	const env = {
		...gitEnv({ source: "none" }),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_ATTR_NOSYSTEM: "1",
		GIT_OPTIONAL_LOCKS: "0",
	};
	const read = (...args: string[]) =>
		execFileSync("git", ["-c", "core.fsmonitor=", ...args], {
			cwd: root,
			env: { ...gitEnv({ source: "none" }), ...env },
			encoding: "utf8",
			timeout: 15_000,
			windowsHide: true,
		}).trim();
	const index = resolve(root, read("rev-parse", "--git-path", "index"));
	const common = resolve(root, read("rev-parse", "--git-common-dir"));
	const head = read("rev-parse", "--verify", "HEAD");
	const scratch = mkdtempSync(join(tmpdir(), "pl-status-"));
	const close = () => rmSync(scratch, { recursive: true, force: true });
	try {
		mkdirSync(join(scratch, "objects", "info"), { recursive: true });
		mkdirSync(join(scratch, "refs"));
		mkdirSync(join(scratch, "info"));
		writeFileSync(join(scratch, "HEAD"), `${head}\n`);
		writeFileSync(
			join(scratch, "objects", "info", "alternates"),
			`${join(common, "objects").replaceAll("\\", "/")}\n`,
		);
		const config = [
			"[core]",
			"repositoryformatversion = 0",
			"bare = false",
			"fsmonitor =",
			"attributesFile = /dev/null",
			"excludesFile = /dev/null",
			"[status]",
			"showUntrackedFiles = normal",
			"[diff]",
			"ignoreSubmodules = all",
		];
		const allowed: Record<string, RegExp> = {
			"core.autocrlf": /^(true|false|input)$/,
			"core.eol": /^(lf|crlf|native)$/,
			"core.filemode": /^(true|false)$/,
			"core.symlinks": /^(true|false)$/,
			"core.ignorecase": /^(true|false)$/,
		};
		for (const [key, pattern] of Object.entries(allowed)) {
			try {
				const value = read("config", "--get", key).toLowerCase();
				if (pattern.test(value))
					config.push(`[core]\n${key.slice(5)} = ${value}`);
			} catch {
				/* Unset: Git's default. */
			}
		}
		writeFileSync(join(scratch, "config"), `${config.join("\n")}\n`);
		if (existsSync(index)) copyFileSync(index, join(scratch, "index"));
		for (const dir of new Set([dirname(index), common])) {
			for (const file of readdirSync(dir))
				if (/^sharedindex\.[0-9a-f]+$/.test(file))
					copyFileSync(join(dir, file), join(scratch, file));
		}
		for (const file of ["exclude", "attributes"]) {
			const source = join(common, "info", file);
			if (existsSync(source)) copyFileSync(source, join(scratch, "info", file));
		}
		return {
			env: {
				...env,
				GIT_DIR: scratch,
				GIT_WORK_TREE: root,
				GIT_INDEX_FILE: join(scratch, "index"),
				GIT_NO_REPLACE_OBJECTS: "1",
			},
			close,
		};
	} catch (error) {
		close();
		throw error;
	}
}
