// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArmScore, ScoringOracle } from "./ab-runner.js";

export interface DiagnosisV1 {
	schema_version: "diagnosis.v1";
	run_id?: string;
	scenario?: string;
	score: number;
	axes: {
		root_cause_correct: boolean;
		evidence_grounded: boolean;
		false_leads: boolean;
	};
	rationale: string;
	/** The judge emits a string, but a bare number is accepted and rendered verbatim. */
	rubric_version: string | number;
	judge_model: string;
	judged_at?: string;
}

export interface RcaJudgeOracleOptions {
	/** Path to the sreforge checkout; also the judge's cwd. */
	sreforgeRepo: string;
	/** Scenario dir — absolute, or relative to `sreforgeRepo`. */
	scenarioDir: string;
	judgeEnv?: Record<string, string>;
	/** default 300_000 */
	timeoutMs?: number;
	/** default "node" */
	node?: string;
}

interface ProcessRunResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	spawnError?: Error;
}

/** Hard cap on captured child output — a chatty judge must not grow unbounded in memory. */
const MAX_CAPTURE_CHARS = 64 * 1024;
/** Hard cap on the stderr tail that lands in an ArmScore note (and thus the capture artifact). */
const MAX_TAIL_CHARS = 1000;

function getStderrTail(stderr: string): string {
	const trimmed = stderr.trim();
	if (!trimmed) return "";
	const lines = trimmed.split("\n");
	const tail = lines.slice(-5).join("\n").trim();
	return tail.length > MAX_TAIL_CHARS
		? `…${tail.slice(-MAX_TAIL_CHARS)}`
		: tail;
}

function runProcess(
	nodeBin: string,
	args: string[],
	env: Record<string, string | undefined>,
	timeoutMs: number,
	cwd: string,
): Promise<ProcessRunResult> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(nodeBin, args, {
				cwd,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			resolve({
				code: null,
				signal: null,
				stdout: "",
				stderr: "",
				timedOut: false,
				spawnError: err instanceof Error ? err : new Error(String(err)),
			});
			return;
		}

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let finished = false;

		let timer: NodeJS.Timeout | undefined;
		if (timeoutMs > 0) {
			timer = setTimeout(() => {
				timedOut = true;
				try {
					child.kill("SIGTERM");
				} catch {
					// Ignore kill failure
				}
				setTimeout(() => {
					if (!finished) {
						try {
							child.kill("SIGKILL");
						} catch {
							// Ignore kill failure
						}
					}
				}, 1000).unref();
			}, timeoutMs);
		}

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout = (stdout + chunk.toString("utf8")).slice(-MAX_CAPTURE_CHARS);
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf8")).slice(-MAX_CAPTURE_CHARS);
		});

		// A pipe error (EPIPE / EBADF) on a child stdio stream with no "error" listener
		// is an UNCAUGHT exception — it would kill the eval process mid-capture. The
		// oracle must never throw, so swallow it; `close` still settles the promise.
		child.stdout?.on("error", () => {});
		child.stderr?.on("error", () => {});

		child.on("error", (err) => {
			if (finished) return;
			finished = true;
			if (timer) clearTimeout(timer);
			resolve({
				code: null,
				signal: null,
				stdout,
				stderr,
				timedOut: false,
				spawnError: err,
			});
		});

		child.on("close", (code, signal) => {
			if (finished) return;
			finished = true;
			if (timer) clearTimeout(timer);
			resolve({
				code,
				signal,
				stdout,
				stderr,
				timedOut,
			});
		});
	});
}

async function fileExists(path: string): Promise<boolean> {
	try {
		const st = await stat(path);
		return st.isFile();
	} catch {
		return false;
	}
}

/**
 * Names the FIRST field that fails `diagnosis.v1`, or null when the object is
 * valid. A campaign debugging a null score has this note and nothing else, so a
 * reason that points at the wrong field costs more than no reason at all.
 */
function diagnosisV1Reason(obj: unknown): string | null {
	if (typeof obj !== "object" || obj === null) return "is not a JSON object";
	const candidate = obj as Record<string, unknown>;

	if (candidate.schema_version !== "diagnosis.v1") {
		return typeof candidate.schema_version === "string"
			? `schema_version mismatch: expected "diagnosis.v1", got "${candidate.schema_version}"`
			: "schema_version is missing or not a string";
	}
	if (typeof candidate.score !== "number")
		return "score is missing or not a number";
	if (typeof candidate.rationale !== "string")
		return "rationale is missing or not a string";
	if (
		typeof candidate.rubric_version !== "string" &&
		typeof candidate.rubric_version !== "number"
	)
		return "rubric_version is missing or not a string or number";
	if (typeof candidate.judge_model !== "string")
		return "judge_model is missing or not a string";
	if (typeof candidate.axes !== "object" || candidate.axes === null)
		return "axes is missing or not an object";

	// The verdict axes are the whole reason `detail` is preserved. A malformed
	// `axes` wearing a valid schema_version must not reach a capture artifact.
	const axes = candidate.axes as Record<string, unknown>;
	for (const key of [
		"root_cause_correct",
		"evidence_grounded",
		"false_leads",
	] as const) {
		if (typeof axes[key] !== "boolean")
			return `axes.${key} is missing or not a boolean`;
	}

	return null;
}

/** Appends a stderr tail only when there is one — never emit a note ending in ": ". */
function withTail(base: string, tail: string): string {
	return tail ? `${base}: ${tail}` : base;
}

type DiagnosisLoad =
	| { kind: "ok"; diagnosis: DiagnosisV1 }
	| { kind: "absent" }
	| { kind: "invalid"; note: string };

/**
 * Reads `diagnosis.json` if the judge wrote one. Absence is a NORMAL state (`--judge`
 * is best-effort), so it is reported separately from an unusable file.
 */
async function loadDiagnosis(diagPath: string): Promise<DiagnosisLoad> {
	if (!(await fileExists(diagPath))) return { kind: "absent" };

	let content: string;
	try {
		content = await readFile(diagPath, "utf8");
	} catch (readErr) {
		return {
			kind: "invalid",
			note: `rca-judge failed to read diagnosis.json: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
		};
	}

	let obj: unknown;
	try {
		obj = JSON.parse(content);
	} catch (parseErr) {
		return {
			kind: "invalid",
			note: `rca-judge diagnosis.json is malformed JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
		};
	}

	const reason = diagnosisV1Reason(obj);
	if (reason !== null) {
		return { kind: "invalid", note: `rca-judge diagnosis.json ${reason}` };
	}
	const diagnosis = obj as DiagnosisV1;

	// diagnosis.v1 `score` is a weighted sum in [0,1]. A judge bug emitting e.g. 85 for
	// 0.85 must NOT land silently in a capture artifact and skew a campaign's delta.
	if (
		!Number.isFinite(diagnosis.score) ||
		diagnosis.score < 0 ||
		diagnosis.score > 1
	) {
		return {
			kind: "invalid",
			note: `rca-judge diagnosis.json score out of range [0,1]: ${diagnosis.score}`,
		};
	}

	return { kind: "ok", diagnosis };
}

export function rcaJudgeOracle(opts: RcaJudgeOracleOptions): ScoringOracle {
	return async (arm): Promise<ArmScore> => {
		let tmpDir: string | null = null;
		try {
			tmpDir = await mkdtemp(join(tmpdir(), "rca-judge-"));
			const rcaPath = join(tmpDir, "rca.md");
			await writeFile(rcaPath, arm.rawText ?? "", "utf8");

			const nodeBin = opts.node ?? "node";
			const judgeScript = join(
				opts.sreforgeRepo,
				"tools",
				"rca-judge",
				"judge.mjs",
			);
			const args = [
				judgeScript,
				"--judge",
				"--rca-file",
				rcaPath,
				"--scenario",
				opts.scenarioDir,
				"--out",
				tmpDir,
			];

			const env = { ...process.env, ...opts.judgeEnv };
			const timeoutMs = opts.timeoutMs ?? 300_000;

			// The judge resolves `--scenario` against its own cwd (it does
			// `join(scenario, "verify", "oracle.md")`), so run it from the sreforge
			// checkout: `scenarioDir` may be absolute, or relative to `sreforgeRepo`.
			// `--rca-file` and `--out` are absolute tmp paths, unaffected by cwd.
			const result = await runProcess(
				nodeBin,
				args,
				env,
				timeoutMs,
				opts.sreforgeRepo,
			);
			const diag = await loadDiagnosis(join(tmpDir, "diagnosis.json"));

			// FILE-FIRST. Success is keyed on a valid diagnosis.json, never on the exit
			// code: `--judge` is best-effort (no file + exit 0 is normal), and the judge
			// is a separately-versioned tool. If it ever grows a non-zero exit path that
			// runs after the diagnosis is written, discarding a paid-for LLM verdict is
			// the worse failure direction — so a usable file always wins.
			if (diag.kind === "ok") {
				return {
					score: diag.diagnosis.score,
					note: `rca-judge ${diag.diagnosis.judge_model} rubric v${diag.diagnosis.rubric_version}: ${diag.diagnosis.rationale}`,
					detail: diag.diagnosis,
				};
			}

			const stderrTail = getStderrTail(result.stderr);

			if (result.timedOut) {
				return {
					score: null,
					note: `rca-judge timed out after ${timeoutMs}ms`,
				};
			}

			if (result.spawnError) {
				return {
					score: null,
					note: `rca-judge spawn error: ${result.spawnError.message}`,
				};
			}

			if (result.code !== 0) {
				return {
					score: null,
					note: withTail(
						`rca-judge process exited with code ${result.code}`,
						stderrTail,
					),
				};
			}

			if (diag.kind === "invalid") {
				return { score: null, note: diag.note };
			}

			return {
				score: null,
				note: withTail(
					"rca-judge wrote no diagnosis (best-effort)",
					stderrTail,
				),
			};
		} catch (err) {
			return {
				score: null,
				note: `rca-judge oracle error: ${err instanceof Error ? err.message : String(err)}`,
			};
		} finally {
			if (tmpDir) {
				try {
					await rm(tmpDir, { recursive: true, force: true });
				} catch {
					// Ignore cleanup error
				}
			}
		}
	};
}
