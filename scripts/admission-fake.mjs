#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Runs the harness admission (R1-R7) against the scripted model of
// scripts/fakes/fake-model-server.mjs, so a PR's verdict never depends on a live model (#884).
//   node scripts/admission-fake.mjs <opencode|claude-code> <cloneDir> [--repeat N]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startFakeModelServer } from "./fakes/fake-model-server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FAKE_MODEL = "fake/scripted";

/**
 * The env that points one agent at the fake and nowhere else; a throwaway home keeps
 * the runner's own sign-in out of the verdict.
 * @param {"opencode" | "claude-code"} harness
 * @param {{ url: string, openaiBaseUrl: string }} fake
 * @param {string} home
 * @returns {Record<string, string>}
 */
export function agentEnv(harness, fake, home) {
	if (harness === "claude-code")
		return {
			ANTHROPIC_BASE_URL: fake.url,
			ANTHROPIC_API_KEY: "scripted",
			CLAUDE_CONFIG_DIR: join(home, "claude"),
		};
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
					options: { baseURL: fake.openaiBaseUrl, apiKey: "scripted" },
					models: { scripted: { name: "Scripted", tool_call: true } },
				},
			},
		}),
	);
	return {
		XDG_CONFIG_HOME: config,
		XDG_DATA_HOME: join(home, "data"),
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
		new RegExp(`^${label}: (\\w+)`, "m").exec(stdout)?.[1] ?? "missing";
	return {
		pass: report.pass === true,
		failedChecks: Object.entries(report.checks ?? {})
			.filter(([, ok]) => !ok)
			.map(([name]) => name),
		r5: word("R5 resume"),
		r6: word("R6 user model"),
		r7: word("R7 resume after a failed report"),
	};
}

/** One verdict as one comparable line. */
export const signature = (/** @type {ReturnType<typeof verdictOf>} */ v) =>
	`R1-R4=${v.pass ? "pass" : `fail(${v.failedChecks.join(",") || "no report"})`} R5=${v.r5} R6=${v.r6} R7=${v.r7}`;

/**
 * @param {string} harness
 * @param {string} cloneDir
 * @param {Record<string, string>} env
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function admissionOnce(harness, cloneDir, env) {
	return new Promise((resolveRun) => {
		const args = [
			"--filter",
			"@prismalens/engine",
			"exec",
			"tsx",
			"scripts/acp-admission.ts",
			harness,
			cloneDir,
		];
		const options = { cwd: ROOT, env: { ...process.env, ...env } };
		const child =
			process.platform === "win32"
				? spawn(`pnpm ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
						...options,
						shell: true,
					})
				: spawn("pnpm", args, options);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
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

async function main() {
	const [harness, cloneArg] = process.argv.slice(2);
	const repeatAt = process.argv.indexOf("--repeat");
	const repeat = repeatAt > -1 ? Number(process.argv[repeatAt + 1]) : 1;
	if (
		(harness !== "opencode" && harness !== "claude-code") ||
		!cloneArg ||
		!Number.isInteger(repeat) ||
		repeat < 1
	) {
		console.error(
			"usage: admission-fake.mjs <opencode|claude-code> <cloneDir> [--repeat N]",
		);
		process.exit(2);
	}
	const cloneDir = resolve(cloneArg);
	const fake = await startFakeModelServer();
	const home = mkdtempSync(join(tmpdir(), "pl-admission-fake-"));
	const lines = [];
	let worst = 0;
	try {
		const env = agentEnv(harness, fake, home);
		for (let run = 1; run <= repeat; run++) {
			const { code, stdout, stderr } = await admissionOnce(
				harness,
				cloneDir,
				env,
			);
			const verdict = verdictOf(stdout);
			const line = signature(verdict);
			lines.push(line);
			console.log(`run ${run}/${repeat}: exit ${code} ${line}`);
			if (code !== 0) {
				worst = 1;
				console.log(stdout);
				console.error(stderr.slice(-2000));
			}
		}
	} finally {
		console.log(`fake model served ${fake.requests().length} requests`);
		await fake.close();
		rmSync(home, { recursive: true, force: true });
	}
	if (new Set(lines).size > 1) {
		console.error("verdicts differ across runs");
		worst = 1;
	}
	process.exit(worst);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
