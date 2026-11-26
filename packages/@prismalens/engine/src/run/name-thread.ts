// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread's title from a small model (#1101 - Wave 2: thread UX hill climb, round 2):
 * one tool-free prompt in its own short session on the thread's agent, closed at once.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LaunchPolicy, versionOf } from "@prismalens/agent-host";
import type { HarnessId } from "@prismalens/config/harness";
import type { TurnUsage } from "@prismalens/contracts/schemas";
import { flattenAcpContent } from "../adapter/acp-adapter.js";
import { AcpSession } from "../runner/acp-client.js";
import {
	type CheckIsolationOptions,
	CheckNotIsolatedError,
	checkIsolationOf,
	isolateCheck,
	removeRunDir,
} from "./harness-doctor.js";
import { prepareRunEnv } from "./investigate.js";
import { toolFreePolicy } from "./permission.js";

/** Starts with the readiness check's prefix, so its stale-folder sweep takes these too. */
const RUN_DIR_PREFIX = "pl-doctor-title-";
const NAME_TIMEOUT_MS = 60_000;

export interface NameThreadOptions {
	prompt: string;
	/** The model to ask; absent keeps the agent's own. */
	model?: string;
	env?: Record<string, string>;
	policy?: LaunchPolicy;
	binaryPath?: string;
	launchArgs?: string[];
	timeoutMs?: number;
	/** MCP server names found in the agent's config files; each is turned off by name. */
	mcp?: CheckIsolationOptions["mcp"];
	probeIsolation?: CheckIsolationOptions["probeIsolation"];
	/** Test-only: fills the title session's scratch folder right after it is made. */
	seedWorkspace?: (cwd: string) => void;
}

/**
 * The agent's whole answer and its usage; throws on any failure, the caller keeps its title.
 * Runs only isolated, as a health check does (#1180 R1).
 */
export async function nameThread(
	harness: HarnessId,
	opts: NameThreadOptions,
): Promise<{ text: string; usage?: TurnUsage; model: string | null }> {
	const use =
		opts.probeIsolation !== undefined
			? opts.probeIsolation
			: checkIsolationOf(harness);
	if (!use) throw new CheckNotIsolatedError(harness, "no safe check");
	if (use.holdsThroughTurn === false)
		throw new CheckNotIsolatedError(
			harness,
			"its switches do not hold through a turn",
		);
	const runDir = mkdtempSync(join(tmpdir(), RUN_DIR_PREFIX));
	const cwd = join(runDir, "workspace");
	mkdirSync(cwd, { recursive: true });
	opts.seedWorkspace?.(cwd);
	const timeoutMs = opts.timeoutMs ?? NAME_TIMEOUT_MS;
	let session: AcpSession | null = null;
	try {
		const prepared = prepareRunEnv({
			harness,
			cwd,
			runDir,
			env: opts.env ?? {},
			accessLevel: "supervised",
			...(opts.policy ? { policy: opts.policy } : {}),
			...(opts.binaryPath ? { binaryPath: opts.binaryPath } : {}),
			...(opts.launchArgs ? { launchArgs: opts.launchArgs } : {}),
		});
		const { launch, runEnv } = prepared;
		const { env, args, sessionMeta } = await isolateCheck(
			harness,
			{ env: prepared.env, args: prepared.args },
			{
				requireIsolation: true,
				probeIsolation: use,
				...(opts.mcp ? { mcp: opts.mcp } : {}),
				runDir,
				versionOf: () =>
					versionOf(
						runEnv.companionPath ?? launch.command,
						undefined,
						prepared.env,
					),
			},
		);
		const s = new AcpSession({
			command: launch.command,
			args,
			cwd,
			env,
			...(sessionMeta ? { sessionMeta } : {}),
			permission: toolFreePolicy,
			initTimeoutMs: timeoutMs,
			promptTimeoutMs: timeoutMs,
			limits: { wallClockMs: timeoutMs },
		});
		session = s;
		await s.open();
		// A refused title model sends no prompt, as its RPC error did before (#1171).
		if (
			opts.model &&
			s.modelOptionId &&
			(await s.setConfigOption(s.modelOptionId, opts.model)) !== opts.model
		)
			throw new Error(`the agent refused the title model ${opts.model}`);
		// The lowest effort the agent lists; its first value by ACP convention.
		const lowest = s.effort?.values[0];
		if (s.effort && lowest && lowest !== s.effort.default)
			await s.setConfigOption(s.effort.id, lowest).catch(() => null);
		let text = "";
		let usage: TurnUsage | undefined;
		for await (const item of s.prompt(opts.prompt)) {
			if (item.kind === "error") throw new Error(item.message);
			if (
				item.kind === "update" &&
				!item.sessionId &&
				item.update.sessionUpdate === "agent_message_chunk"
			)
				text += flattenAcpContent(item.update.content);
			if (item.kind === "done") {
				usage = item.usage;
				break;
			}
		}
		return {
			text,
			...(usage ? { usage } : {}),
			model: opts.model ?? s.servedModel,
		};
	} finally {
		await session?.close().catch(() => undefined);
		removeRunDir(runDir);
	}
}
