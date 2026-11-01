#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Qualifies one agent against the scripted model (aimock, scripts/fakes/scripted-model.mjs):
// the admission (R1-R10) and the behaviour matrix, so a PR's verdict never depends on a live model (#884, #914).
//   node scripts/admission-fake.mjs <agent> <cloneDir> [--repeat N] [--only admission|matrix] [--rows a,b] [--journal]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCRIPTED_KEY, startScriptedModel } from "./fakes/scripted-model.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const AGENTS = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"deepagents",
];
export const FAKE_MODEL = "fake/scripted";
const KEYS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"CODEX_API_KEY",
	"GEMINI_API_KEY",
	"GOOGLE_API_KEY",
];

/**
 * The env that points one agent at the scripted model and nowhere else; a throwaway home
 * keeps the runner's own sign-in out of the verdict. `key: null` writes the same home with
 * no key in it: the agent is not signed in, and a call it makes anyway still reaches aimock.
 * Retries are capped so a row with a persistent fault ends inside its time.
 * @param {string} harness
 * @param {{ url: string, openaiBaseUrl: string }} model
 * @param {string} home
 * @param {string | null} [key]
 * @returns {Record<string, string>}
 */
export function agentEnv(harness, model, home, key = SCRIPTED_KEY) {
	const withKey = (/** @type {string} */ name) => (key ? { [name]: key } : {});
	if (harness === "claude-code")
		return {
			ANTHROPIC_BASE_URL: model.url,
			...withKey("ANTHROPIC_API_KEY"),
			CLAUDE_CONFIG_DIR: join(home, "claude"),
			// MCP tools go in the request, not behind tool search, so the script sees incident_get (#848).
			ENABLE_TOOL_SEARCH: "false",
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			CLAUDE_CODE_MAX_RETRIES: "1",
		};
	if (harness === "codex") {
		const codexHome = join(home, "codex");
		mkdirSync(codexHome, { recursive: true });
		writeFileSync(
			join(codexHome, "config.toml"),
			[
				'model = "scripted"',
				'model_provider = "fake"',
				"",
				"[model_providers.fake]",
				'name = "Scripted"',
				`base_url = "${model.openaiBaseUrl}"`,
				'wire_api = "responses"',
				'env_key = "OPENAI_API_KEY"',
				"request_max_retries = 1",
				"stream_max_retries = 1",
				"",
			].join("\n"),
		);
		return { CODEX_HOME: codexHome, ...withKey("OPENAI_API_KEY") };
	}
	if (harness === "gemini") {
		const geminiHome = join(home, "gemini");
		mkdirSync(join(geminiHome, ".gemini"), { recursive: true });
		writeFileSync(
			join(geminiHome, ".gemini", "settings.json"),
			// A named model skips Gemini's model router, a side call per turn.
			JSON.stringify({
				security: { auth: { selectedType: "gemini-api-key" } },
				model: { name: "gemini-2.5-flash" },
				general: { maxAttempts: 2 },
			}),
		);
		return {
			GEMINI_CLI_HOME: geminiHome,
			// Folder trust is on by default, and an untrusted folder loads no MCP server (the row's toolsHint).
			GEMINI_CLI_TRUST_WORKSPACE: "true",
			GOOGLE_GEMINI_BASE_URL: model.url,
			...withKey("GEMINI_API_KEY"),
		};
	}
	if (harness === "deepagents") {
		const profile = join(home, "deepagents");
		mkdirSync(profile, { recursive: true });
		writeFileSync(
			join(profile, "config.toml"),
			[
				"[models]",
				'default = "openai:scripted"',
				"",
				"[models.providers.openai]",
				`base_url = "${model.openaiBaseUrl}"`,
				'api_key_env = "OPENAI_API_KEY"',
				'models = ["scripted"]',
				"",
				"[retries]",
				"max_retries = 1",
				"",
			].join("\n"),
		);
		return {
			DEEPAGENTS_HOME: profile,
			DEEPAGENTS_CODE_NO_UPDATE_CHECK: "1",
			...withKey("OPENAI_API_KEY"),
		};
	}
	const config = join(home, "config");
	mkdirSync(join(config, "opencode"), { recursive: true });
	writeFileSync(
		join(config, "opencode", "opencode.json"),
		JSON.stringify({
			$schema: "https://opencode.ai/config.json",
			provider: {
				fake: {
					npm: "@ai-sdk/openai-compatible",
					name: "Scripted",
					options: {
						baseURL: model.openaiBaseUrl,
						...(key ? { apiKey: key } : {}),
					},
					models: { scripted: { name: "Scripted", tool_call: true } },
				},
			},
			// Without these OpenCode falls back to its own hosted models.
			model: FAKE_MODEL,
			small_model: FAKE_MODEL,
		}),
	);
	return {
		XDG_CONFIG_HOME: config,
		XDG_DATA_HOME: join(home, "data"),
		XDG_CACHE_HOME: join(home, "cache"),
		XDG_STATE_HOME: join(home, "state"),
		PRISMALENS_HARNESS_MODEL: FAKE_MODEL,
	};
}

/**
 * The verdict of one admission run: the pass flag and each R-line's first word.
 * @param {string} stdout
 */
export function verdictOf(stdout) {
	const start = stdout.indexOf("{");
	const end = stdout.indexOf("\n}\n", start);
	/** @type {{ pass?: boolean, checks?: Record<string, boolean> }} */
	let report = {};
	try {
		report = JSON.parse(stdout.slice(start, end + 2));
	} catch {
		// an unparseable report is a failed run
	}
	const word = (/** @type {string} */ label) =>
		new RegExp(`^${label}: ([\\w/]+)`, "m").exec(stdout)?.[1] ?? "missing";
	return {
		pass: report.pass === true,
		failedChecks: Object.entries(report.checks ?? {})
			.filter(([, ok]) => !ok)
			.map(([name]) => name),
		r5: word("R5 resume"),
		r6: word("R6 user model"),
		r7: word("R7 resume after a failed report"),
		r8: word("R8 tool call, first turn"),
		r9: word("R9 tool call, follow-up"),
		r10: word("R10 resume streams no history"),
	};
}

/**
 * Admission failures caused by an agent's own open bug. The run passes while the agent
 * fails exactly this way, and fails once it no longer does, so a fix upstream is noticed (#914).
 * @type {Record<string, { failedChecks: string[], r5: string, why: string }>}
 */
export const KNOWN_ADMISSION_FAILURES = {
	gemini: {
		failedChecks: ["cwdProved", "readAllowed"],
		r5: "pass",
		why: "shell output never reaches ACP clients (google-gemini/gemini-cli#29930)",
	},
};

/**
 * `null` when the admission's outcome is acceptable for this agent, else why not.
 * @param {string} harness
 * @param {ReturnType<typeof verdictOf>} v
 * @param {number} code
 */
export function admissionProblem(harness, v, code) {
	const known = KNOWN_ADMISSION_FAILURES[harness];
	if (!known) return code === 0 ? null : "the admission failed";
	const same =
		!v.pass &&
		v.failedChecks.join(",") === known.failedChecks.join(",") &&
		v.r5 === known.r5 &&
		[v.r8, v.r9, v.r10].every((r) => r === "pass" || r === "n/a");
	if (same) return null;
	return code === 0 || v.pass
		? `the known failure is fixed (${known.why}); remove it from KNOWN_ADMISSION_FAILURES`
		: "the admission failed differently from its known failure";
}

/** One verdict as one comparable line. */
export const signature = (/** @type {ReturnType<typeof verdictOf>} */ v) =>
	`R1-R4=${v.pass ? "pass" : `fail(${v.failedChecks.join(",") || "no report"})`} R5=${v.r5} R6=${v.r6} R7=${v.r7} R8=${v.r8} R9=${v.r9} R10=${v.r10}`;

/**
 * Each matrix row's first word, as one comparable line.
 * @param {string} stdout
 */
export const matrixSignature = (stdout) =>
	[...stdout.matchAll(/^ROW ([\w-]+): ([\w/]+)/gm)]
		.map((m) => `${m[1]}=${m[2]}`)
		.join(" ") || "no rows";

/**
 * @param {string} script
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @param {boolean} [live] echo stdout as it arrives
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function engineScript(script, args, env, live = false) {
	return new Promise((resolveRun) => {
		const all = [
			"--filter",
			"@prismalens/engine",
			"exec",
			"tsx",
			`scripts/${script}`,
			...args,
		];
		const options = { cwd: ROOT, env: { ...process.env, ...env } };
		const child =
			process.platform === "win32"
				? spawn(`pnpm ${all.map((a) => JSON.stringify(a)).join(" ")}`, {
						...options,
						shell: true,
					})
				: spawn("pnpm", all, options);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
			if (live) process.stdout.write(d);
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("close", (code) =>
			resolveRun({ code: code ?? 1, stdout, stderr }),
		);
		child.on("error", (err) => {
			const detail =
				/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT"
					? "pnpm not found on PATH"
					: `failed to start pnpm: ${err.message}`;
			resolveRun({ code: 1, stdout, stderr: `${stderr}${detail}\n` });
		});
	});
}

/** @param {string[]} argv */
export function parseArgs(argv) {
	const [harness, cloneArg] = argv;
	const flag = (/** @type {string} */ name) => {
		const at = argv.indexOf(name);
		return at > -1 ? argv[at + 1] : undefined;
	};
	const repeat = Number(flag("--repeat") ?? 1);
	const only = flag("--only");
	if (
		!AGENTS.includes(harness ?? "") ||
		!cloneArg ||
		!Number.isInteger(repeat) ||
		repeat < 1 ||
		(only !== undefined && only !== "admission" && only !== "matrix")
	)
		return null;
	return {
		harness: /** @type {string} */ (harness),
		cloneDir: resolve(cloneArg),
		repeat,
		admission: only !== "matrix",
		matrix: only !== "admission",
		rows: flag("--rows"),
		journal: argv.includes("--journal"),
	};
}

const MATRIX_AT_ONCE = 3;

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args) {
		console.error(
			`usage: admission-fake.mjs <${AGENTS.join("|")}> <cloneDir> [--repeat N] [--only admission|matrix] [--rows a,b] [--journal]`,
		);
		process.exit(2);
	}
	const home = mkdtempSync(join(tmpdir(), "pl-admission-fake-"));
	const workdir = mkdtempSync(join(homedir(), ".pl-matrix-"));
	/** @type {Awaited<ReturnType<typeof startScriptedModel>>[]} */
	const models = [];
	const startModel = async () => {
		const model = await startScriptedModel(args.harness);
		models.push(model);
		return model;
	};
	/** @typedef {Awaited<ReturnType<typeof startScriptedModel>>} Model */
	/** The entries one run added to a model's journal and requests: the admission shares its model. */
	const windowOf = (/** @type {Model} */ model) => {
		const j = model.journal().length;
		const r = model.requests().length;
		return () => ({
			journal: model.journal().slice(j),
			requests: model.requests().slice(r),
		});
	};
	const runs = Array.from({ length: args.repeat }, () => ({
		/** @type {string[]} */ parts: [],
		failed: false,
		/** @type {{ journal: ReturnType<Model["journal"]>, requests: ReturnType<Model["requests"]> }[]} */ seen: [],
	}));
	const lines = [];
	let worst = 0;
	try {
		if (args.admission) {
			const model = await startModel();
			const env = agentEnv(args.harness, model, home);
			// The admission writes its cwd probe into the one clone, so its runs take turns.
			for (const run of runs) {
				model.resetMatchCounts();
				const seen = windowOf(model);
				const out = await engineScript(
					"acp-admission.ts",
					[args.harness, args.cloneDir],
					env,
				);
				run.seen.push(seen());
				const verdict = verdictOf(out.stdout);
				run.parts.push(signature(verdict));
				const problem = admissionProblem(args.harness, verdict, out.code);
				if (out.code !== 0 && !problem)
					console.log(
						`known failure: ${KNOWN_ADMISSION_FAILURES[args.harness]?.why}`,
					);
				if (problem) {
					run.failed = true;
					console.log(problem);
					console.log(out.stdout);
					console.error(out.stderr.slice(-2000));
				}
			}
		}
		if (args.matrix) {
			// Each matrix run has its own scripted model, home and workspace, so the runs can go at
			// once: most of a run is waiting on the agent's own retries and timeouts (#885).
			/** @param {(typeof runs)[number]} run @param {number} i */
			const matrixRun = async (run, i) => {
				const model = await startModel();
				const seen = windowOf(model);
				const runHome = mkdtempSync(join(home, `matrix-${i + 1}-`));
				const signedOut = agentEnv(
					args.harness,
					model,
					mkdtempSync(join(runHome, "signed-out-")),
					null,
				);
				/** @type {Record<string, string | null>} */
				const overrides = Object.fromEntries(KEYS.map((k) => [k, null]));
				Object.assign(overrides, signedOut);
				const out = await engineScript(
					"acp-matrix.ts",
					[args.harness, ...(args.rows ? ["--only", args.rows] : [])],
					{
						...agentEnv(args.harness, model, runHome),
						PL_MATRIX_SIGNED_OUT: JSON.stringify(overrides),
						PL_MATRIX_WORKDIR: mkdtempSync(join(workdir, `run-${i + 1}-`)),
					},
					args.repeat === 1,
				);
				if (args.repeat > 1)
					process.stdout.write(
						`matrix run ${i + 1}/${args.repeat}:\n${out.stdout}`,
					);
				run.seen.push(seen());
				run.parts.push(matrixSignature(out.stdout));
				if (out.code !== 0) {
					run.failed = true;
					console.error(out.stderr.slice(-2000));
				}
			};
			// Only Linux: the cancel row tells its own tool process from another run's by cwd,
			// which only /proc gives (acp-scenarios.ts), so elsewhere the runs take turns.
			// At most MATRIX_AT_ONCE: each run holds a scripted model and an agent tree.
			const atOnce = process.platform === "linux" ? MATRIX_AT_ONCE : 1;
			let next = 0;
			const lane = async () => {
				for (let i = next++; i < runs.length; i = next++)
					await matrixRun(runs[i], i);
			};
			await Promise.all(Array.from({ length: atOnce }, lane));
		}
		for (const [i, run] of runs.entries()) {
			const line = run.parts.join(" | ");
			lines.push(line);
			console.log(
				`run ${i + 1}/${args.repeat}: ${run.failed ? "FAIL" : "ok"} ${line}`,
			);
			if (run.failed) worst = 1;
			if (!run.failed && !args.journal) continue;
			for (const { journal, requests } of run.seen) {
				const statuses = journal.map((e) => {
					const m = /** @type {any} */ (e.response.fixture)?.match;
					const tag = m
						? Object.entries(m)
								.filter(([k]) => k !== "toolName")
								.map(([k, v]) =>
									k === "predicate" ? "p" : `${k}=${String(v).slice(0, 24)}`,
								)
								.join(",")
						: "none";
					return `${e.response.status}[${tag}]`;
				});
				console.log("scripted model requests (last 80):");
				for (const r of requests.slice(-80)) console.log(JSON.stringify(r));
				console.log(`served: ${statuses.slice(-80).join(" ")}`);
			}
		}
	} finally {
		const served = models.reduce((n, m) => n + m.journal().length, 0);
		console.log(`scripted model served ${served} requests`);
		await Promise.all(models.map((m) => m.close()));
		rmSync(home, { recursive: true, force: true });
		rmSync(workdir, { recursive: true, force: true, maxRetries: 5 });
	}
	if (new Set(lines).size > 1) {
		console.error("verdicts differ across runs");
		worst = 1;
	}
	process.exit(worst);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
