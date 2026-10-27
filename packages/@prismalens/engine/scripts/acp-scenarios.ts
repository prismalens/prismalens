// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The behaviour matrix (#914): each row of scripts/fakes/scenarios/rows/ runs the real
 * engine against the real agent, whose model is the scripted aimock. A row passes on what
 * the engine observed (events, the files and processes the run left), never on model text.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	InvestigationContext,
} from "@prismalens/contracts/schemas";
import type {
	Expectation,
	GatewayExpectation,
	Row,
} from "../../../../scripts/fakes/scripted-model.mjs";
import {
	isCancelledError,
	prepareRunEnv,
	runInvestigation,
} from "../src/run/investigate.js";
import {
	deny,
	optionOf,
	type PermissionPolicy,
} from "../src/run/permission.js";
import { AcpSession } from "../src/runner/acp-client.js";
import { parseTranscript } from "./admission-checks.js";
import { startStubGateway } from "./stub-gateway.js";

export const ROW_RUN_ID = "00000000-0000-4000-8000-0000000000a1";
const DEFAULT_PROMPT_MS = 120_000;

const CONTEXT: InvestigationContext = {
	alerts: [
		{
			alertname: "ScenarioProbe",
			severity: "warning",
			labels: { service: "scenario" },
			annotations: {
				description:
					"Synthetic alert for the behaviour matrix. Find the repository's main entry point and name the file.",
			},
			startsAt: "2026-01-01T00:00:00.000Z",
		},
	],
	service: { name: "scenario" },
};

/** The person at the run's card: allows each ask once, or refuses it. */
const answerPolicy =
	(answer: "allow" | "deny"): PermissionPolicy =>
	(req) => {
		const allow = optionOf(req, "allow");
		return answer === "allow" && allow
			? { allow: true, optionId: allow.optionId, outcome: "approved" }
			: deny(req, "denied", "the matrix row refuses every ask");
	};

/** What one row left behind, for `checkRow`. */
export interface RowObservation {
	events: CanonicalEvent[];
	elapsedMs: number;
	/** The agent answered a request on the wire, so a failure is not a launch failure. */
	agentSpoke: boolean;
	/** Files the row's shell step may have written, by name. */
	files: Record<string, boolean>;
	/** The cancelled tool's process outlived the run. */
	orphan?: boolean;
	/** The tool to cancel never started. */
	neverRan?: boolean;
	/** The run outlived the row's whole budget and was stopped. */
	hung?: boolean;
	session?: { modes: string[]; models: string[] };
}

export interface RowEnv {
	harness: HarnessId;
	env: NodeJS.ProcessEnv;
	/** The same agent with no key and an empty home. */
	signedOutEnv: NodeJS.ProcessEnv;
}

/** Pid and command line of every process on this machine. */
function processes(): { pid: number; args: string }[] {
	const out =
		process.platform === "win32"
			? execFileSync(
					"powershell",
					[
						"-NoProfile",
						"-Command",
						'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }',
					],
					{ encoding: "utf8" },
				)
			: execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
	return out.split(/\r?\n/).flatMap((line) => {
		const m = /^\s*(\d+) (.*)$/.exec(line);
		return m ? [{ pid: Number(m[1]), args: m[2] ?? "" }] : [];
	});
}
/** The program a command line runs: `node` for `"C:\…\node.exe" -e …` or `node -e …`. */
const program = (args: string): string =>
	(/^"([^"]+)"|^(\S+)/.exec(args.trim())?.slice(1).find(Boolean) ?? "")
		.split(/[\\/]/)
		.pop()
		?.replace(/\.exe$/i, "")
		.toLowerCase() ?? "";

/**
 * This row's `node` processes running `needle`: the tool itself, never the agent's shell wrapper
 * around it, which shows the needle before the tool starts (#885). On Linux only those whose cwd is
 * the row's workspace, so matrix runs going at once (admission-fake.mjs) never see each other's.
 */
function running(needle: string, workspace: string): number[] {
	// /proc reports the physical path; the workspace may sit under a symlink.
	const root =
		process.platform === "linux" ? realpathSync(workspace) : workspace;
	return processes()
		.filter(({ pid, args }) => {
			if (!args.includes(needle) || program(args) !== "node") return false;
			if (process.platform !== "linux") return true;
			try {
				return readlinkSync(`/proc/${pid}/cwd`).startsWith(root);
			} catch {
				return false;
			}
		})
		.map(({ pid }) => pid);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openSession(
	harness: HarnessId,
	cwd: string,
	runDir: string,
	env: NodeJS.ProcessEnv,
): Promise<{ modes: string[]; models: string[] }> {
	const {
		env: runEnvVars,
		runEnv,
		launch,
	} = prepareRunEnv({
		harness,
		cwd,
		runDir,
		env,
		hostEnv: env,
	});
	const acp = new AcpSession({
		command: launch.command,
		args: [...launch.args, ...HARNESS_REGISTRY[harness].acpArgs(runEnv)],
		cwd,
		env: runEnvVars,
		permission: answerPolicy("deny"),
		initTimeoutMs: 60_000,
	});
	try {
		await acp.open();
		return {
			modes: acp.offeredModes.map((m) => m.id),
			models: acp.models.map((m) => m.id),
		};
	} finally {
		await acp.close();
	}
}

/** Runs one row through the engine in a fresh workspace. */
export async function runRow(row: Row, base: RowEnv): Promise<RowObservation> {
	// Outside the temp dir: Codex's read-only sandbox lets a command write under /tmp.
	const workspace = mkdtempSync(
		join(process.env.PL_MATRIX_WORKDIR ?? tmpdir(), "pl-matrix-ws-"),
	);
	const runDir = mkdtempSync(join(tmpdir(), "pl-matrix-run-"));
	writeFileSync(join(workspace, "README.md"), "# scenario\n");
	writeFileSync(
		join(workspace, "package.json"),
		'{ "name": "scenario", "main": "index.js" }\n',
	);
	const started = Date.now();
	const env = row.run.signedOut ? base.signedOutEnv : base.env;
	const transcript = join(runDir, "transcript.jsonl");
	const agentSpoke = () =>
		existsSync(transcript) &&
		parseTranscript(readFileSync(transcript, "utf8")).some(
			(l) => l.d === "in" && l.m.includes('"result"'),
		);
	const files = () =>
		Object.fromEntries(
			["scenario-allowed.txt", "scenario-declined.txt"].map((f) => [
				f,
				existsSync(join(workspace, f)),
			]),
		);
	try {
		if (row.run.sessionOnly) {
			const session = await openSession(base.harness, workspace, runDir, env);
			return {
				events: [],
				elapsedMs: Date.now() - started,
				agentSpoke: true,
				files: {},
				session,
			};
		}
		const promptMs = row.run.promptTimeoutMs ?? DEFAULT_PROMPT_MS;
		const controller = new AbortController();
		let hung = false;
		// A first prompt, the report retry and a margin: past that the run is hung.
		const watchdog = setTimeout(
			() => {
				hung = true;
				controller.abort();
			},
			60_000 + 3 * promptMs,
		);
		const needle = row.run.cancelWhenRunning;
		let sawTool = false;
		const poll = needle
			? setInterval(() => {
					if (!sawTool && running(needle, workspace).length > 0) {
						sawTool = true;
						controller.abort();
					}
				}, 500)
			: undefined;
		const events: CanonicalEvent[] = [];
		// Every row runs with PrismaLens's tools, as a real run does (#848); off only to compare.
		const stub =
			process.env.PL_MATRIX_GATEWAY === "off" ? null : await startStubGateway();
		try {
			for await (const ev of runInvestigation({
				harness: base.harness,
				runId: ROW_RUN_ID,
				context: CONTEXT,
				accessLevel: row.run.accessLevel ?? "auto",
				cwd: workspace,
				runDir,
				env,
				// The floor inherits the host env (#817), so a signed-out row needs a signed-out host too.
				hostEnv: env,
				permission: answerPolicy(row.run.answer ?? "deny"),
				promptSuffix: `[row:${row.row}] Follow the scripted steps, then report.`,
				sandboxCheck: async () => ({}),
				initTimeoutMs: 60_000,
				promptTimeoutMs: promptMs,
				signal: controller.signal,
				...(stub ? { gateway: stub.entry } : {}),
			}))
				events.push(ev);
		} finally {
			clearTimeout(watchdog);
			if (poll) clearInterval(poll);
			await stub?.close();
		}
		let orphan: boolean | undefined;
		if (needle && sawTool) {
			orphan = true;
			let pids: number[] = [];
			for (let i = 0; i < 20 && orphan; i++) {
				pids = running(needle, workspace);
				orphan = pids.length > 0;
				if (orphan) await sleep(500);
			}
			// Who outlived the cancel, on stderr, which admission-fake.mjs prints only for a failed run.
			if (orphan && process.platform !== "win32")
				console.error(
					spawnSync(
						"ps",
						["-o", "pid,ppid,pgid,stat,etime,args", "-p", pids.join(",")],
						{
							encoding: "utf8",
						},
					).stdout,
				);
			// A known orphan (cancelled-orphaned) must not outlive the matrix run either.
			for (const pid of orphan ? running(needle, workspace) : []) {
				try {
					process.kill(pid);
				} catch {
					// already gone
				}
			}
		}
		return {
			events,
			elapsedMs: Date.now() - started,
			agentSpoke: agentSpoke(),
			files: files(),
			...(needle ? { neverRan: !sawTool } : {}),
			...(orphan !== undefined ? { orphan } : {}),
			...(hung ? { hung } : {}),
		};
	} finally {
		for (const dir of [workspace, runDir])
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	}
}

/** The outcome a row expects of this agent, and why it differs from the row's, if it does. */
export function expectationFor(
	row: Row,
	harness: string,
): { expect: Expectation; why?: string } {
	return row.agents?.[harness] ?? { expect: row.expect };
}

/** `null` when the row saw what it expects, else what it saw instead. */
export function checkRow(
	harness: HarnessId,
	expect: Expectation,
	seen: RowObservation,
	gateway?: GatewayExpectation,
): string | null {
	if (seen.hung) return `hung: still running after ${seen.elapsedMs}ms`;
	if (!seen.agentSpoke && expect !== "exited")
		return "the agent never answered on the wire";
	const kinds = seen.events.map((e) => e.kind);
	const errors = seen.events.flatMap((e) =>
		e.kind === "error" ? [e.message] : [],
	);
	const answers = seen.events.flatMap((e) =>
		e.kind === "permission_answer" ? [e.outcome] : [],
	);
	const toolResults = kinds.filter((k) => k === "tool_result").length;
	const report = kinds.includes("report");
	const firstTool = seen.events.find((e) => e.kind === "tool_result");
	const tool =
		firstTool?.kind === "tool_result"
			? `; tool ${firstTool.result.source.slice(0, 60)} ${firstTool.result.ok ? "ok" : `failed ${firstTool.result.error?.slice(0, 80) ?? ""}`}`
			: "";
	const saw = `events ${[...new Set(kinds)].join(",") || "none"}${tool}${errors.length ? `; error ${errors[0]?.slice(0, 160)}` : ""}`;
	switch (expect) {
		case "report":
			return report && errors.length === 0 ? null : `no clean report (${saw})`;
		case "tool-report":
			return toolResults > 0 && report
				? null
				: `no tool result and report (${saw})`;
		case "parallel":
			return toolResults >= 2 && report
				? null
				: `${toolResults} tool results (${saw})`;
		case "allowed":
			return answers.some((o) => o === "approved" || o === "allowed") &&
				seen.files["scenario-allowed.txt"] &&
				report
				? null
				: `asks ${JSON.stringify(answers)}, file ${seen.files["scenario-allowed.txt"] ? "written" : "absent"} (${saw})`;
		case "declined":
			return answers.length > 0 &&
				!answers.some((o) => o === "approved" || o === "allowed") &&
				!seen.files["scenario-declined.txt"]
				? null
				: `asks ${JSON.stringify(answers)}, file ${seen.files["scenario-declined.txt"] ? "written" : "absent"} (${saw})`;
		case "cancelled":
			if (seen.neverRan) return `the tool never started (${saw})`;
			if (seen.orphan) return "the cancelled tool's process outlived the run";
			return errors.some(isCancelledError) ? null : `not cancelled (${saw})`;
		case "cancelled-orphaned":
			if (seen.neverRan) return `the tool never started (${saw})`;
			if (!seen.orphan)
				return "the cancelled tool's process stopped: the known failure is fixed, so expect `cancelled` for this agent";
			return errors.some(isCancelledError) ? null : `not cancelled (${saw})`;
		case "error":
			return errors.length > 0 && !report
				? null
				: `expected an error and no report (${saw})`;
		case "exited":
			return !seen.agentSpoke &&
				errors.some((m) => m.includes("exited early")) &&
				!report
				? null
				: `expected the agent to exit before answering (${saw})`;
		case "fault":
			return toolResults > 0 && errors.length > 0 && !report
				? null
				: `expected the step's tool result, then an error and no report (${saw})`;
		case "gateway":
			if (!report) return `no report (${saw})`;
			return gatewayProblem(seen.events, gateway);
		case "modes": {
			const row = HARNESS_REGISTRY[harness];
			const s = seen.session ?? { modes: [], models: [] };
			const wantModes = row.modeMechanism === "acp";
			const wantModels = row.modelVia === "acp";
			const ok =
				s.modes.length > 0 === wantModes &&
				(!wantModels || s.models.length > 0);
			return ok
				? null
				: `modes [${s.modes.join(",")}] (registry ${row.modeMechanism}), ${s.models.length} models (registry ${row.modelVia})`;
		}
	}
}

/**
 * `null` when the run recorded PrismaLens's tool calls a `gateway` row expects, in order,
 * each with the outcome and the text the real tool answers with (#848).
 */
export function gatewayProblem(
	events: readonly CanonicalEvent[],
	want: GatewayExpectation | undefined,
): string | null {
	if (!want) return "the row names no gateway expectation";
	const calls = events.flatMap((e) =>
		e.kind === "harness_tool_call" ? [e] : [],
	);
	let at = 0;
	for (const w of want.calls) {
		const i = calls.findIndex(
			(c, n) =>
				n >= at &&
				c.name === w.name &&
				(c.isError === true) === !w.ok &&
				(!w.outputHas || (c.output ?? "").includes(w.outputHas)),
		);
		if (i < 0)
			return `no ${w.ok ? "successful" : "failed"} ${w.name}${w.outputHas ? ` answering "${w.outputHas}"` : ""} after call ${at}; saw ${calls.map((c) => `${c.name}${c.isError ? "!" : ""}`).join(",") || "no PrismaLens call"}`;
		at = i + 1;
	}
	const ids = (type: "evidence" | "hypothesis") =>
		events.flatMap((e) =>
			e.kind === "finding_recorded" && e.finding.type === type
				? [e.finding.id]
				: [],
		);
	for (const [type, wanted] of [
		["evidence", want.records?.evidence],
		["hypothesis", want.records?.hypotheses],
	] as const)
		for (const id of wanted ?? [])
			if (!ids(type).includes(id))
				return `no recorded ${type} "${id}" (saw ${ids(type).join(",") || "none"})`;
	const titles = events.flatMap((e) =>
		e.kind === "artifact_published" ? [e.artifact.title] : [],
	);
	for (const title of want.artifacts ?? [])
		if (!titles.includes(title))
			return `no published page "${title}" (saw ${titles.join(",") || "none"})`;
	return null;
}
