// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
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

/** Each read; the API's one thread never waits on git, and a hung git is killed here. */
export const STATUS_GIT_TIMEOUT_MS = 10_000;

/** git off the event loop, with stdin when given; rejects on a non-zero exit or the timeout. */
export function readGit(
	args: string[],
	opts: { cwd: string; env: NodeJS.ProcessEnv; input?: string },
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			"git",
			args,
			{
				cwd: opts.cwd,
				env: opts.env,
				encoding: "utf8",
				timeout: STATUS_GIT_TIMEOUT_MS,
				maxBuffer: 16 * 1024 * 1024,
				windowsHide: true,
			},
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
		// git can exit before reading stdin; the write then fails with EPIPE, which is not the result.
		child.stdin?.on("error", () => {});
		child.stdin?.end(opts.input ?? "");
	});
}

/** A private config and index keep status from executing checkout-defined filters or hooks (#1066). */
export async function checkoutStatus(root: string): Promise<{
	env: Record<string, string>;
	close: () => void;
	hasFilters: boolean;
}> {
	const env = {
		...gitEnv({ source: "none" }),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_OPTIONAL_LOCKS: "0",
	};
	const read = async (...args: string[]) =>
		(
			await readGit(["-c", "core.fsmonitor=", ...args], {
				cwd: root,
				env: gitEnv({ source: "none" }),
			})
		).replace(/\r?\n$/, "");
	const index = resolve(root, await read("rev-parse", "--git-path", "index"));
	const common = resolve(root, await read("rev-parse", "--git-common-dir"));
	const head = await read("rev-parse", "--verify", "HEAD");
	const format = await read("rev-parse", "--show-object-format");
	if (format !== "sha1" && format !== "sha256")
		throw new Error("Unsupported Git object format");
	const attributes = (
		await readGit(
			["-c", "core.fsmonitor=", "check-attr", "-z", "--stdin", "filter"],
			{
				cwd: root,
				env: gitEnv({ source: "none" }),
				input: await read("ls-files", "-z"),
			},
		)
	).split("\0");
	const drivers = new Set(
		attributes.filter((_, i) => i % 3 === 2).filter((name) => name !== ""),
	);
	let hasFilters = false;
	for (const name of drivers)
		for (const kind of ["clean", "process"])
			if (
				!hasFilters &&
				(await read("config", "--get", `filter.${name}.${kind}`).catch(
					() => "",
				)) !== ""
			)
				hasFilters = true;

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
			`repositoryformatversion = ${format === "sha256" ? 1 : 0}`,
			"bare = false",
			"fsmonitor =",
			"[status]",
			"showUntrackedFiles = normal",
			"[diff]",
			"ignoreSubmodules = all",
		];
		if (format === "sha256")
			config.push("[extensions]", "objectFormat = sha256");
		const allowed: Record<string, RegExp> = {
			"core.autocrlf": /^(true|false|input)$/,
			"core.eol": /^(lf|crlf|native)$/,
			"core.filemode": /^(true|false)$/,
			"core.symlinks": /^(true|false)$/,
			"core.ignorecase": /^(true|false)$/,
		};
		for (const [key, pattern] of Object.entries(allowed)) {
			try {
				const value = (await read("config", "--get", key)).toLowerCase();
				if (pattern.test(value))
					config.push(`[core]\n${key.slice(5)} = ${value}`);
			} catch {
				/* Unset: Git's default. */
			}
		}
		for (const key of ["core.attributesFile", "core.excludesFile"]) {
			try {
				const value = await read("config", "--path", "--get", key);
				if (value)
					config.push(
						`[core]\n${key.slice(5)} = ${JSON.stringify(resolve(root, value).replaceAll("\\", "/"))}`,
					);
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
			hasFilters,
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
