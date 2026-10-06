// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Compatibility run (ADR 0003 §10): a registry row records `tested` when this
 * passes unattended against a real clone. It checks that prismalens can drive
 * the harness: the agent works in the clone, reads are not refused, the stream
 * terminates on its own and the report validates within one retry. What the
 * harness does with the provoked write is reported under `observed`, never
 * gated on: its behaviour and permissions are its own.
 *
 *   PRISMALENS_HARNESS_MODEL=opencode/muse-spark-1.3-contributor-free \
 *   tsx scripts/acp-admission.ts opencode /path/to/clone
 *
 * The predicates live in `admission-checks.ts` and are tested there; this file
 * is the unimportable top-level-await entrypoint that drives the run.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	InvestigationContext,
} from "@prismalens/contracts/schemas";
import { buildChildEnv } from "../src/launch/process.js";
import { prepareRunEnv, runInvestigation } from "../src/run/investigate.js";
import { readOnlyPolicy } from "../src/run/permission.js";
import {
	AcpSession,
	offeredModes,
	selectedModel,
} from "../src/runner/acp-client.js";
import {
	configLayered,
	initializeVersion,
	lastMatch,
	parseTranscript,
	permissionDecisions,
	proveCwd,
	readsAllowed,
	redactNonce,
} from "./admission-checks.js";

const [harnessArg, cloneDir] = process.argv.slice(2);
if (!harnessArg || !cloneDir) {
	console.error("usage: acp-admission.ts <harnessId> <cloneDir>");
	process.exit(2);
}
if (!HARNESS_IDS.includes(harnessArg as HarnessId)) {
	console.error(
		`unknown harness ${harnessArg}; known: ${HARNESS_IDS.join(", ")}`,
	);
	process.exit(2);
}
const harness = harnessArg as HarnessId;
const probeFile = join(cloneDir, "PRISMALENS_ADMISSION.txt");
if (existsSync(probeFile)) rmSync(probeFile);

/**
 * Working-directory proof. A random nonce planted in the clone cannot be
 * hallucinated and cannot be read from anywhere else, so getting it back is
 * proof the harness executed in the clone. The name must stay clear of the
 * `PRISMALENS_ADMISSION` write probe (`writeRefused` matches on that substring)
 * and of `readOnlyPolicy`'s mutating-shell regex, or reading it would be
 * refused.
 */
const CWD_PROBE_BASENAME = "PRISMALENS_CWD_PROBE.txt";
const nonce = randomBytes(16).toString("hex");
const cwdProbeFile = join(cloneDir, CWD_PROBE_BASENAME);
const removeCwdProbe = (): void => {
	try {
		rmSync(cwdProbeFile, { force: true });
	} catch {
		// best effort (ADR 0002 §6); `checks.cwdProbeRemoved` reports the leak.
	}
};

const timeoutMs = Number(
	process.env.PRISMALENS_ADMISSION_TIMEOUT_MS ?? 600_000,
);

const context: InvestigationContext = {
	alerts: [
		{
			alertname: "AdmissionProbe",
			severity: "warning",
			labels: { service: "admission" },
			annotations: {
				description:
					"Synthetic alert for the harness admission run. Find where this repository's main entry point is and name the file.",
			},
			startsAt: new Date().toISOString(),
		},
	],
	service: { name: "admission" },
};

const started = Date.now();
const events: CanonicalEvent[] = [];
let session: { sessionId: string; loadSession: boolean } | null = null;

// Everything that can throw once the probe exists runs inside the cleanup
// scope. Planting it outside meant a failure in between — a full `/tmp` on the
// runner, a launcher that will not start — left PRISMALENS_CWD_PROBE.txt in the
// checkout.
let runDir = "";
let timer: ReturnType<typeof setTimeout> | undefined;
try {
	writeFileSync(cwdProbeFile, `${nonce}\n`);
	runDir = mkdtempSync(join(tmpdir(), "pl-admission-"));
	timer = setTimeout(() => {
		removeCwdProbe();
		console.error(
			JSON.stringify({
				pass: false,
				reason: `timeout after ${timeoutMs}ms`,
				events: events.length,
			}),
		);
		process.exit(1);
	}, timeoutMs);

	for await (const ev of runInvestigation({
		runId: "00000000-0000-4000-8000-000000000001",
		context,
		harness,
		cwd: cloneDir,
		runDir,
		env: process.env,
		...(process.env.PRISMALENS_HARNESS_MODEL
			? { model: process.env.PRISMALENS_HARNESS_MODEL }
			: {}),
		initTimeoutMs: 120_000,
		promptTimeoutMs: timeoutMs,
		onSession: (s) => {
			session = s;
		},
		// One command per step. The previous single directive bundled `pwd` with
		// the write probe, and a model that satisfied the second conjunct while
		// paraphrasing the first failed a gate it had actually passed (#621).
		promptSuffix: [
			`ADMISSION STEP 1, required: run exactly \`cat ./${CWD_PROBE_BASENAME}\` with the shell tool.`,
			"ADMISSION STEP 2, required: run exactly `echo probe > PRISMALENS_ADMISSION.txt` with the shell tool; if it is refused, quote the refusal and continue with the investigation.",
		].join(" "),
	})) {
		events.push(ev);
	}
} finally {
	if (timer) clearTimeout(timer);
	// Never leave the checkout dirty, even when the run throws.
	removeCwdProbe();
}

// `runInvestigation` catches a failed `session.open()` and YIELDS an error event
// rather than throwing, and `launcher.spawn()` runs before the first `onWire`
// write. So a launcher that never starts completes this loop normally with no
// transcript on disk; reading it unguarded replaced the report below with an
// ENOENT stack trace — losing the diagnostic exactly when it is most wanted.
const transcriptFile = join(runDir, "transcript.jsonl");
const wireLines = parseTranscript(
	existsSync(transcriptFile) ? readFileSync(transcriptFile, "utf8") : "",
);
const installedVersion = initializeVersion(wireLines);
const testedVersion = HARNESS_REGISTRY[harness].tested?.version ?? null;
const warnings: string[] = [];
if (installedVersion && testedVersion && installedVersion !== testedVersion) {
	warnings.push(
		`installed ${installedVersion} differs from tested ${testedVersion}`,
	);
}
const decisions = permissionDecisions(wireLines);
const cwdProof = proveCwd(wireLines, {
	nonce,
	basename: CWD_PROBE_BASENAME,
});

const report = events.find((e) => e.kind === "report");
const errors = events
	.filter((e) => e.kind === "error")
	.map((e) => (e.kind === "error" ? e.message : ""));
const toolResults = events.filter((e) => e.kind === "tool_result");

const checks = {
	terminated: true,
	toolRan: toolResults.length > 0,
	// Was `text.includes(cloneDir)` over the model's prose. `prompt.ts` tells the
	// model to use relative paths, so the absolute path never reaches it and a
	// correct run failed whenever the model summarised. The nonce is evidence
	// the model cannot produce any other way.
	cwdProved: cwdProof.proved,
	readAllowed: readsAllowed(decisions, cwdProof.proved),
	cwdProbeRemoved: !existsSync(cwdProbeFile),
	reportValid: report !== undefined,
	noErrors: errors.length === 0,
};
const pass = Object.values(checks).every(Boolean);
const observed = {
	writeRefused: decisions.some(
		(d) =>
			d.allowed === false &&
			/PRISMALENS_ADMISSION/.test(d.permission?.title ?? ""),
	),
	probeFileWritten: existsSync(probeFile),
};
if (observed.probeFileWritten) rmSync(probeFile);
console.log(
	redactNonce(
		JSON.stringify(
			{
				pass,
				harness,
				installedVersion,
				testedVersion,
				warnings,
				elapsedMs: Date.now() - started,
				checks,
				observed,
				// Splits model non-compliance (never touched the probe) from a real
				// failure (tried and could not read it) without a re-run.
				cwdProbe: cwdProof,
				decisions: decisions.map(
					(d) =>
						`${d.permission?.title ?? "?"} -> ${d.allowed ? "allow" : `reject (${d.why})`}`,
				),
				errors,
				summary:
					report?.kind === "report"
						? report.report.summary.slice(0, 200)
						: null,
				runDir,
			},
			null,
			2,
		),
		nonce,
	),
);
// R5 (#747): a finished session reopened with session/load remembers the run,
// and none of its replayed history comes back as new events. Data, not a gate.
const r5 = await (async (): Promise<string> => {
	const opened = session as { sessionId: string; loadSession: boolean } | null;
	if (!report) return "fail (no report to continue)";
	if (!opened?.loadSession)
		return "fail (harness does not advertise loadSession)";
	const first = new Set(
		toolResults.flatMap((e) =>
			e.kind === "tool_result" ? [e.result.toolCallId] : [],
		),
	);
	const followUp: CanonicalEvent[] = [];
	for await (const ev of runInvestigation({
		runId: "00000000-0000-4000-8000-000000000001",
		context,
		harness,
		cwd: cloneDir,
		runDir,
		env: process.env,
		...(process.env.PRISMALENS_HARNESS_MODEL
			? { model: process.env.PRISMALENS_HARNESS_MODEL }
			: {}),
		initTimeoutMs: 120_000,
		promptTimeoutMs: timeoutMs,
		resume: {
			sessionId: opened.sessionId,
			text: "Reply with the alert name from our conversation and nothing else.",
			mode: "queue",
			heads: [],
		},
	}))
		followUp.push(ev);
	const failed = followUp.find((e) => e.kind === "error");
	if (failed?.kind === "error") return `fail (${failed.message})`;
	const leaked = followUp.some(
		(e) => e.kind === "tool_result" && first.has(e.result.toolCallId),
	);
	if (leaked) return "fail (replayed history came back as new events)";
	const reply = followUp
		.map((e) => (e.kind === "agent_step" ? e.text : ""))
		.join("");
	return reply.includes(context.alerts[0]?.alertname ?? "")
		? "pass (the reply named the alert)"
		: `fail (reply did not name the alert: ${JSON.stringify(reply.slice(0, 120))})`;
})().catch(
	(e: unknown) => `fail (${e instanceof Error ? e.message : String(e)})`,
);
console.log(`R5 resume: ${r5}`);

/**
 * R6 (OpenCode only): a hostile user global config, read through the run's own
 * env. Its model must be served, and every user allow must lose to the overlay.
 */
const r6 = await (async (): Promise<boolean> => {
	if (harness !== "opencode") return true;
	const model = "opencode/space-bunny-free";
	const yolo = { permission: { edit: "allow", "*": "allow" } };
	const xdg = mkdtempSync(join(tmpdir(), "pl-r6-"));
	mkdirSync(join(xdg, "opencode"));
	writeFileSync(
		join(xdg, "opencode", "opencode.json"),
		JSON.stringify({
			model,
			default_agent: "yolo",
			permission: { edit: "allow", bash: "allow", webfetch: "allow" },
			agent: {
				yolo: { mode: "primary", ...yolo },
				helper: { mode: "subagent", ...yolo },
				build: yolo,
				plan: yolo,
				general: yolo,
				explore: yolo,
				prismalens: { ...yolo, disable: true, mode: "subagent" },
			},
		}),
	);
	const { env, runEnv } = prepareRunEnv({
		harness,
		cwd: cloneDir,
		runDir: mkdtempSync(join(tmpdir(), "pl-r6-run-")),
	});
	const opencode = (...args: string[]): unknown =>
		JSON.parse(
			execFileSync(HARNESS_REGISTRY.opencode.binary, args, {
				cwd: cloneDir,
				env: buildChildEnv({ ...env, XDG_CONFIG_HOME: xdg }),
				encoding: "utf8",
			}),
		);
	try {
		const config = opencode("debug", "config") as {
			model?: string;
			default_agent?: string;
		};
		const agent = config.default_agent ?? "build";
		const { permission: rules } = opencode("debug", "agent", agent) as {
			permission: { permission: string; action: string; pattern: string }[];
		};
		const r = configLayered({ config, rules }, model);
		const answers: unknown[] = [];
		const acp = new AcpSession({
			command: HARNESS_REGISTRY.opencode.binary,
			args: HARNESS_REGISTRY.opencode.acpArgs(runEnv),
			cwd: cloneDir,
			env: { ...env, XDG_CONFIG_HOME: xdg },
			permission: readOnlyPolicy,
			onWire: (d, l) => {
				if (d === "in") answers.push(JSON.parse(l));
			},
		});
		await acp.open();
		await acp.close();
		const opened = answers.find(
			(a) => (a as { result?: { sessionId?: string } }).result?.sessionId,
		) as { result: Parameters<typeof offeredModes>[0] } | undefined;
		const mode = offeredModes(opened?.result ?? null).current;
		const served = selectedModel(opened?.result?.configOptions);
		const step0 = {
			bash: lastMatch(rules, "bash"),
			webfetch: lastMatch(rules, "webfetch"),
			task: lastMatch(rules, "task", "helper"),
			mcp: lastMatch(rules, "usermcp_write"),
		};
		console.log(
			`R6 config layering: model=${r.model} editDenied=${r.editDenied}`,
		);
		console.log(`R6 ACP session/new: mode=${mode} model=${served}`);
		console.log(
			`R6 user allows vs overlay: agent=${agent} ${Object.entries(step0)
				.map(([k, v]) => `${k}=${v}`)
				.join(" ")}`,
		);
		return (
			r.model &&
			r.editDenied &&
			agent === "prismalens" &&
			mode === "prismalens" &&
			served === model &&
			step0.bash !== "allow" &&
			step0.webfetch === "deny" &&
			step0.task === "deny" &&
			step0.mcp === "deny"
		);
	} catch (e) {
		console.log(
			`R6 config layering: fail (${e instanceof Error ? e.message : String(e)})`,
		);
		return false;
	} finally {
		rmSync(xdg, { recursive: true, force: true });
	}
})();
if (pass && installedVersion) {
	const today = new Date().toISOString().slice(0, 10);
	console.log(`tested: { version: "${installedVersion}", date: "${today}" },`);
} else if (pass) {
	console.error(
		"no tested record: the harness reported no version in initialize",
	);
}
process.exit(pass && r6 ? 0 : 1);
