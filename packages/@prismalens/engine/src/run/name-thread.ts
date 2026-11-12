// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A thread's title from a small model (#1101 - Wave 2: thread UX hill climb, round 2):
 * one tool-free prompt in its own short session on the thread's agent, closed at once.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaunchPolicy } from "@prismalens/agent-host";
import type { HarnessId } from "@prismalens/config/harness";
import type { TurnUsage } from "@prismalens/contracts/schemas";
import { flattenAcpContent } from "../adapter/acp-adapter.js";
import { AcpSession } from "../runner/acp-client.js";
import { removeRunDir } from "./harness-doctor.js";
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
}

/** The agent's whole answer and its usage; throws on any failure, the caller keeps its title. */
export async function nameThread(
	harness: HarnessId,
	opts: NameThreadOptions,
): Promise<{ text: string; usage?: TurnUsage; model: string | null }> {
	const runDir = mkdtempSync(join(tmpdir(), RUN_DIR_PREFIX));
	const cwd = join(runDir, "workspace");
	mkdirSync(cwd, { recursive: true });
	const timeoutMs = opts.timeoutMs ?? NAME_TIMEOUT_MS;
	let session: AcpSession | null = null;
	try {
		const { env, args, launch } = prepareRunEnv({
			harness,
			cwd,
			runDir,
			env: opts.env ?? {},
			accessLevel: "supervised",
			...(opts.policy ? { policy: opts.policy } : {}),
			...(opts.binaryPath ? { binaryPath: opts.binaryPath } : {}),
			...(opts.launchArgs ? { launchArgs: opts.launchArgs } : {}),
		});
		const s = new AcpSession({
			command: launch.command,
			args,
			cwd,
			env,
			permission: toolFreePolicy,
			initTimeoutMs: timeoutMs,
			promptTimeoutMs: timeoutMs,
			limits: { wallClockMs: timeoutMs },
		});
		session = s;
		await s.open();
		if (opts.model && s.modelOptionId)
			await s.setConfigOption(s.modelOptionId, opts.model);
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
