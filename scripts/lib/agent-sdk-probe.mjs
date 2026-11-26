#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Probes the Claude Agent SDK in an installed app the way its consumers use it, with no
// credentials (#1269): every symbol engine and the adapters import, with its exact type,
// then accountInfo, the usage call and engine's readLimits against scripts/lib/fake-claude.mjs.
// Usage: node scripts/lib/agent-sdk-probe.mjs <installed app dir>

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	RATE_LIMITS,
	SIGNED_IN_ACCOUNT,
	SIGNED_OUT_USAGE_ERROR,
} from "./fake-claude.mjs";

const SDK = "@anthropic-ai/claude-agent-sdk";
const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fake-claude.mjs");

/** The type each imported SDK symbol must have; a new import fails until it is listed here. */
export const SYMBOL_TYPES = {
	deleteSession: "function",
	filterEscalatingDefaultMode: "function",
	forkSession: "function",
	getSessionInfo: "function",
	getSessionMessages: "function",
	getSubagentMessages: "function",
	importSessionToStore: "function",
	listSessions: "function",
	matchDeniedModels: "function",
	query: "function",
	resolveSettings: "function",
	USAGE_LIMIT_ERROR_PREFIXES: "string[]",
};

const IMPORT = new RegExp(
	`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${SDK.replace("/", "\\/")}["']`,
	"g",
);

/** The SDK symbols each built adapter imports, by the file it imports them in. */
export function adapterImports(adaptersDir) {
	const byFile = new Map();
	for (const name of readdirSync(adaptersDir)) {
		if (!name.endsWith(".mjs")) continue;
		const file = join(adaptersDir, name);
		const names = new Set();
		for (const match of readFileSync(file, "utf8").matchAll(IMPORT))
			for (const part of match[1].split(","))
				if (part.trim()) names.add(part.trim().split(/\s+as\s+/)[0]);
		if (names.size) byFile.set(file, names);
	}
	return byFile;
}

function typeOf(value) {
	if (Array.isArray(value))
		return value.length && value.every((v) => typeof v === "string")
			? "string[]"
			: "array";
	return typeof value;
}

/** Problems with the symbols `names`, imported from `from` as its own resolution finds the SDK. */
export async function symbolProblems(from, names) {
	const sdk = await import(
		pathToFileURL(createRequire(from).resolve(SDK)).href
	);
	const problems = [];
	for (const name of [...names].sort()) {
		const want = SYMBOL_TYPES[name];
		if (!want)
			problems.push(`${name}: imported but has no type in SYMBOL_TYPES`);
		else if (typeOf(sdk[name]) !== want)
			problems.push(`${name}: expected ${want}, got ${typeOf(sdk[name])}`);
	}
	return { sdk, problems };
}

function session(query, env) {
	let release = () => {};
	const opened = new Promise((r) => {
		release = r;
	});
	const prompt = {
		[Symbol.asyncIterator]: () => ({
			next: async () => {
				await opened;
				return { done: true, value: undefined };
			},
		}),
	};
	const q = query({
		prompt,
		options: {
			pathToClaudeCodeExecutable: FAKE,
			env,
			settingSources: [],
			strictMcpConfig: true,
			mcpServers: {},
		},
	});
	return {
		q,
		close: () => {
			release();
			q.close();
		},
	};
}

/** The environment the fake agent needs: the platform's own, never the user's credentials. */
export function bareEnv() {
	return Object.fromEntries(
		["PATH", "Path", "SystemRoot", "TEMP", "TMP"]
			.filter((k) => process.env[k] !== undefined)
			.map((k) => [k, process.env[k]]),
	);
}

/** accountInfo and the usage call, as limits-read makes them, against a signed-out agent. */
export async function checkSignedOut(query, base = bareEnv()) {
	const out = session(query, { ...base, FAKE_CLAUDE: "signed-out" });
	try {
		deepStrictEqual(await out.q.accountInfo(), {});
		const usage =
			out.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		strictEqual(typeof usage, "function");
		const failure = await usage.call(out.q, { skipBehaviors: true }).then(
			() => null,
			(error) => error,
		);
		strictEqual(failure?.message, SIGNED_OUT_USAGE_ERROR);
	} finally {
		out.close();
	}
}

export async function probe(appDir) {
	const engineDir = join(appDir, "node_modules", "@prismalens", "engine");
	const adaptersDir = join(
		appDir,
		"node_modules",
		"@prismalens",
		"agent-adapters",
		"dist",
		"adapters",
	);
	const problems = [];
	const engine = await symbolProblems(join(engineDir, "package.json"), [
		"query",
	]);
	problems.push(...engine.problems.map((p) => `engine ${p}`));
	let symbols = 1;
	for (const [file, names] of adapterImports(adaptersDir)) {
		symbols += names.size;
		const found = await symbolProblems(file, names);
		problems.push(...found.problems.map((p) => `${file}: ${p}`));
	}
	if (problems.length) throw new Error(problems.join("\n"));

	const base = bareEnv();
	await checkSignedOut(engine.sdk.query, base);

	const manifest = JSON.parse(
		readFileSync(join(engineDir, "package.json"), "utf8"),
	);
	const entry = manifest.exports?.["."]?.import ?? manifest.main;
	const { readLimits } = await import(
		pathToFileURL(join(engineDir, entry)).href
	);
	const scratch = mkdtempSync(join(tmpdir(), "pl-sdk-probe-"));
	try {
		const read = await readLimits(
			"claude-code",
			{ command: FAKE, env: base, cwd: scratch },
			{
				home: scratch,
				managedSettingsPath: join(scratch, "managed-settings.json"),
				now: () => new Date("2026-01-01T00:00:00.000Z"),
				budgetMs: 20_000,
			},
		);
		deepStrictEqual(read, {
			account: SIGNED_IN_ACCOUNT.email,
			at: "2026-01-01T00:00:00.000Z",
			windows: [
				{
					key: "five_hour:session",
					window: "session",
					type: "five_hour",
					usedPercent: RATE_LIMITS.five_hour.utilization,
					resetsAt: RATE_LIMITS.five_hour.resets_at,
					status: null,
				},
				{
					key: "seven_day:weekly",
					window: "weekly",
					type: "seven_day",
					usedPercent: RATE_LIMITS.seven_day.utilization,
					resetsAt: RATE_LIMITS.seven_day.resets_at,
					status: null,
				},
			],
		});
	} finally {
		// On Windows the closed child can hold its cwd past this point; the folder is scratch.
		try {
			rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
		} catch {}
	}
	return { symbols };
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		const { symbols } = await probe(resolve(process.argv[2]));
		console.log(
			`agent SDK probe: ${symbols} imported symbols typed; signed-out accountInfo and usage, and readLimits, answered as expected`,
		);
	} catch (error) {
		console.error(`AGENT SDK PROBE FAIL: ${error.message}`);
		process.exit(1);
	}
}
