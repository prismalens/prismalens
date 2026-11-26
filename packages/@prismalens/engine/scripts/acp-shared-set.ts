// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The `shared-set-reaches-agent` row (#1180 §3.3): a shared stdio marker server goes to the agent
 * as `pl-mk`, the scripted model calls its tool after PrismaLens's own (the positive control: the
 * agent connected MCP servers at all), then the session is taken up with `session/load` and the
 * tool is called again, since `session/load` carries `mcpServers` too.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import type { Row } from "../../../../scripts/fakes/scripted-model.mjs";
import { runInvestigation } from "../src/run/investigate.js";
import type { RunShared } from "../src/run/shared-set.js";
import { answerPolicy, CONTEXT, ROW_RUN_ID } from "./acp-scenarios.js";
import { startStubGateway } from "./stub-gateway.js";

const MARKER = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../scripts/fakes/markers/marker.mjs",
);

export async function runSharedSetRow(
	row: Row,
	harness: HarnessId,
	env: NodeJS.ProcessEnv,
): Promise<{ problem: string | null; saw: string }> {
	const markers = mkdtempSync(join(tmpdir(), "pl-matrix-shared-"));
	const workspace = mkdtempSync(
		join(env.PL_MATRIX_WORKDIR ?? tmpdir(), "pl-matrix-ws-"),
	);
	const runDir = mkdtempSync(join(tmpdir(), "pl-matrix-run-"));
	const called = join(markers, "mk.called");
	const shared: RunShared = {
		servers: [
			{
				name: "pl-mk",
				command: process.execPath,
				args: [MARKER, markers, "mk", "mcp", "shared_marker"],
				env: [],
			},
		],
		hidden: [],
		revision: "rev-a",
		instructions: null,
		fingerprint: "matrix",
		profile: "own",
	};
	// An agent that takes the set's instructions in its system prompt gets a marker word per
	// revision, so the row reads which one the model saw against the one PrismaLens recorded.
	const inSystem =
		HARNESS_REGISTRY[harness].facts?.systemPromptVia?.value === "claude-meta";
	const MARK: Record<string, string> = {
		"rev-a": "PLREV-A",
		"rev-b": "PLREV-B",
	};
	const setRevision = (revision: "rev-a" | "rev-b", held?: string | null) => {
		shared.revision = revision;
		shared.instructions = inSystem
			? `Shared instructions ${MARK[revision]}.`
			: null;
		if (held !== undefined) shared.held = held;
	};
	setRevision("rev-a");
	const log = env.PL_MATRIX_PROMPT_LOG;
	const logged = () =>
		log && existsSync(log)
			? readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
			: [];
	/** The PLREV- words the system prompts of this row's requests held, since line `from`. */
	const seenSince = (from: number) =>
		[
			...new Set(
				logged()
					.slice(from)
					.map((l) => JSON.parse(l) as { row: string; system: string[] })
					.filter((l) => l.row === row.row)
					.flatMap((l) => l.system),
			),
		].sort();
	const saw: string[] = [];
	let sessionId: string | null = null;
	const once = async (resume: boolean) => {
		const stub = await startStubGateway({ harness });
		const events: CanonicalEvent[] = [];
		try {
			for await (const ev of runInvestigation({
				harness,
				runId: ROW_RUN_ID,
				context: CONTEXT,
				// Full access: an agent's own approval review of the call is not what the row tests.
				accessLevel: "full-access",
				cwd: workspace,
				runDir,
				env,
				hostEnv: env,
				permission: answerPolicy("allow"),
				promptSuffix: `[row:${row.row}] Follow the scripted steps, then report.`,
				sandboxCheck: async () => ({}),
				initTimeoutMs: 60_000,
				promptTimeoutMs: 120_000,
				gateway: stub.entry,
				shared,
				onSession: (s) => {
					sessionId = s.sessionId;
				},
				...(resume && sessionId
					? {
							resume: {
								sessionId,
								text: `[row:${row.row}] Call the shared marker again.`,
								mode: "queue" as const,
								heads: [],
							},
						}
					: {}),
			}))
				events.push(ev);
		} finally {
			await stub.close();
		}
		const opened = events.find((e) => e.kind === "session_opened");
		const error = events.find((e) => e.kind === "error");
		return {
			gateway: stub.count(),
			how: opened?.kind === "session_opened" ? opened.how : "none",
			recorded:
				opened?.kind === "session_opened"
					? (opened.sharedSet?.revision ?? null)
					: null,
			error: error?.kind === "error" ? error.message.slice(0, 120) : null,
		};
	};
	try {
		const before = logged().length;
		const first = await once(false);
		const firstSaw = seenSince(before);
		const reached = existsSync(called);
		saw.push(
			`new: gateway ${first.gateway}, shared ${reached ? "called" : "not called"}${first.error ? `, error: ${first.error}` : ""}`,
		);
		if (first.gateway === 0)
			return {
				problem:
					"the positive control failed: PrismaLens's own tools were not called",
				saw: saw.join("; "),
			};
		if (inSystem)
			saw.push(
				`model saw ${firstSaw.join(",") || "no marker"}, recorded ${first.recorded}`,
			);
		if (inSystem && !log)
			return {
				problem:
					"PL_MATRIX_PROMPT_LOG is unset: run the row through admission-fake.mjs",
				saw: saw.join("; "),
			};
		if (inSystem && firstSaw.join() !== "PLREV-A")
			return {
				problem:
					"the new session's system prompt did not hold the instructions it was sent",
				saw: saw.join("; "),
			};
		if (!reached || first.error)
			return {
				problem: first.error
					? "the first run ended in an error"
					: "the shared server's tool was not called",
				saw: saw.join("; "),
			};
		if (!HARNESS_REGISTRY[harness].facts?.loadSession?.value)
			return {
				problem: null,
				saw: [...saw, "load: the agent has no session/load"].join("; "),
			};
		rmSync(called, { force: true });
		// The set changes between the runs: the reopened session is sent rev-b over the rev-a it holds.
		setRevision("rev-b", first.recorded);
		const beforeAgain = logged().length;
		const again = await once(true);
		const againSaw = seenSince(beforeAgain);
		const loaded = existsSync(called);
		saw.push(
			`${again.how}: shared ${loaded ? "called" : "not called"}${again.error ? `, error: ${again.error}` : ""}`,
		);
		// An agent whose session/load PrismaLens refuses (BROKEN_LOAD) is skipped here by that cause.
		if (
			again.how === "none" &&
			again.error?.includes("cannot reopen a session")
		)
			return {
				problem: null,
				saw: [...saw.slice(0, -1), `load: skipped, ${again.error}`].join("; "),
			};
		if (again.how !== "load" && again.how !== "resume")
			return {
				problem: `the follow-up opened as ${again.how}, not a reopened session`,
				saw: saw.join("; "),
			};
		if (inSystem)
			saw.push(
				`model saw ${againSaw.join(",") || "no marker"}, recorded ${again.recorded}`,
			);
		const expected = again.recorded ? MARK[again.recorded] : undefined;
		return {
			problem: !loaded
				? "the shared server's tool was not called after session/load"
				: again.error
					? "the reopened run ended in an error"
					: inSystem && againSaw.join() !== expected
						? `after the reopen the model saw ${againSaw.join(",") || "no marker"}, but PrismaLens recorded ${again.recorded}`
						: null,
			saw: saw.join("; "),
		};
	} finally {
		for (const d of [markers, workspace, runDir])
			rmSync(d, { recursive: true, force: true, maxRetries: 3 });
	}
}
