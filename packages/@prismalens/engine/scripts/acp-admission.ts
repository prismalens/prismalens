// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Compatibility run (ADR 0003 §10): a registry row records `tested` when this
 * passes unattended against a real clone. It checks that prismalens can drive
 * the harness: the agent works in the clone, reads are not refused, the stream
 * terminates on its own and the report validates within one retry. Its
 * permission mode is its own (#673 w21), so nothing here provokes a write.
 *
 *   PRISMALENS_HARNESS_MODEL=opencode/muse-spark-1.3-contributor-free \
 *   tsx scripts/acp-admission.ts opencode /path/to/clone
 *
 * The predicates live in `admission-checks.ts` and are tested there; this file
 * is the unimportable top-level-await entrypoint that drives the run.
 */
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
import { prepareRunEnv, runInvestigation } from "../src/run/investigate.js";
import { denyAllPolicy } from "../src/run/permission.js";
import { AcpSession } from "../src/runner/acp-client.js";
import {
	initializeVersion,
	parseTranscript,
	permissionDecisions,
	proveCwd,
	readsAllowed,
	redactNonce,
} from "./admission-checks.js";
import { startReportBreakingProxy } from "./report-breaking-proxy.js";

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

/**
 * Working-directory proof. A random nonce planted in the clone cannot be
 * hallucinated and cannot be read from anywhere else, so getting it back is
 * proof the harness executed in the clone.
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

	// Unattended like an alert-started run, so asks are answered at Auto (#673).
	for await (const ev of runInvestigation({
		runId: "00000000-0000-4000-8000-000000000001",
		context,
		harness,
		accessLevel: "auto",
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
		promptSuffix: `ADMISSION STEP, required: run exactly \`cat ./${CWD_PROBE_BASENAME}\` with the shell tool.`,
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
		accessLevel: "auto",
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
 * R6 (OpenCode only, #791): the model in the user's own OpenCode config is the
 * one served, and a Settings model sent over `session/set_config_option` beats it.
 */
const r6 = await (async (): Promise<string> => {
	if (harness !== "opencode") return "skipped (OpenCode only)";
	const userModel = "opencode/space-bunny-free";
	const xdg = mkdtempSync(join(tmpdir(), "pl-r6-"));
	mkdirSync(join(xdg, "opencode"));
	writeFileSync(
		join(xdg, "opencode", "opencode.json"),
		JSON.stringify({ model: userModel }),
	);
	const runDir = mkdtempSync(join(tmpdir(), "pl-r6-run-"));
	try {
		const { env, runEnv } = prepareRunEnv({ harness, cwd: cloneDir, runDir });
		const acp = new AcpSession({
			command: HARNESS_REGISTRY.opencode.binary,
			args: HARNESS_REGISTRY.opencode.acpArgs(runEnv),
			cwd: cloneDir,
			env: { ...env, XDG_CONFIG_HOME: xdg },
			permission: denyAllPolicy,
		});
		try {
			await acp.open();
			const served = acp.servedModel;
			const settingsModel = acp.models.find((m) => m.id !== userModel)?.id;
			const took =
				acp.modelOptionId && settingsModel
					? await acp.setConfigOption(acp.modelOptionId, settingsModel)
					: null;
			const seen = `user config served ${served}; set_config_option ${settingsModel} answered ${took}`;
			return served === userModel && took === settingsModel
				? `pass (${seen})`
				: `fail (${seen})`;
		} finally {
			await acp.close();
		}
	} finally {
		rmSync(runDir, { recursive: true, force: true });
		rmSync(xdg, { recursive: true, force: true });
	}
})().catch(
	(e: unknown) => `fail (${e instanceof Error ? e.message : String(e)})`,
);
console.log(`R6 user model: ${r6}`);

/**
 * R7 (#673 w59, #804 OBJ-029, DESIGN §3.5): a session whose report failed to
 * validate reopens with session/load through the installed adapter and still
 * holds the run. The first run is a real investigation turn; a model will not
 * fail its report on request, so its text goes through report-breaking-proxy
 * and the report's own retries fail too. A gate: a fail or an inconclusive
 * run exits nonzero. Only an agent that takes ANTHROPIC_BASE_URL can be put
 * behind the proxy; any other is skipped, and says why.
 */
async function reopensAfterFailedReport(): Promise<string> {
	if (!HARNESS_REGISTRY[harness].resume)
		return "skipped (this agent cannot reopen a session)";
	if (harness !== "claude-code")
		return `skipped (${harness} does not take ANTHROPIC_BASE_URL, so its report cannot be broken in transit)`;
	const upstream =
		process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
	const proxy = await startReportBreakingProxy(upstream);
	const dir = mkdtempSync(join(tmpdir(), "pl-r7-"));
	let opened: { sessionId: string; loadSession: boolean } | null = null;
	const common = {
		runId: "00000000-0000-4000-8000-000000000007",
		context,
		harness,
		accessLevel: "auto" as const,
		cwd: cloneDir,
		runDir: dir,
		...(process.env.PRISMALENS_HARNESS_MODEL
			? { model: process.env.PRISMALENS_HARNESS_MODEL }
			: {}),
		initTimeoutMs: 120_000,
		promptTimeoutMs: timeoutMs,
	};
	try {
		const first: CanonicalEvent[] = [];
		for await (const ev of runInvestigation({
			...common,
			env: { ...process.env, ANTHROPIC_BASE_URL: proxy.url },
			onSession: (s) => {
				opened = s;
			},
			promptSuffix:
				"ADMISSION STEP, required: run `ls` once with the shell tool before you answer.",
		}))
			first.push(ev);
		const last = first
			.filter((e) => e.kind === "error" || e.kind === "report")
			.at(-1);
		if (
			last?.kind !== "error" ||
			!last.message.startsWith("report did not validate")
		)
			return `inconclusive (the first run did not end on a failed report: ${last?.kind === "error" ? last.message : (last?.kind ?? "no end")})`;
		const session = opened as {
			sessionId: string;
			loadSession: boolean;
		} | null;
		if (!session?.loadSession)
			return "fail (harness does not advertise loadSession)";
		// Reopened straight to the endpoint, as a continued run is.
		const followUp: CanonicalEvent[] = [];
		for await (const ev of runInvestigation({
			...common,
			env: process.env,
			resume: {
				sessionId: session.sessionId,
				text: "Reply with the alert name from our conversation and nothing else.",
				mode: "queue",
				heads: [],
			},
		}))
			followUp.push(ev);
		const error = followUp.find((e) => e.kind === "error");
		if (error?.kind === "error") return `fail (${error.message})`;
		const reply = followUp
			.map((e) => (e.kind === "agent_step" ? e.text : ""))
			.join("");
		const alert = context.alerts[0]?.alertname ?? "";
		return reply.includes(alert)
			? `pass (${last.message.slice(0, 60)}…; session/load answered with ${alert})`
			: `fail (reply did not name the alert: ${JSON.stringify(reply.slice(0, 120))})`;
	} finally {
		await proxy.close();
		rmSync(dir, { recursive: true, force: true });
	}
}
const r7 = await reopensAfterFailedReport().catch(
	(e: unknown) => `fail (${e instanceof Error ? e.message : String(e)})`,
);
console.log(`R7 resume after a failed report: ${r7}`);
if (pass && installedVersion) {
	const today = new Date().toISOString().slice(0, 10);
	console.log(`tested: { version: "${installedVersion}", date: "${today}" },`);
} else if (pass) {
	console.error(
		"no tested record: the harness reported no version in initialize",
	);
}
const r7Ok = r7.startsWith("pass") || r7.startsWith("skipped");
process.exit(pass && !r6.startsWith("fail") && r7Ok ? 0 : 1);
