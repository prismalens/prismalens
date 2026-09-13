// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Harness readiness probe (#630, Unit D on #337): does the harness answer an
 * ACP handshake at all? `pl doctor` and the on-demand Settings verdict both
 * call this — neither spends a prompt turn or a model call. `AcpSession.open()`
 * is `initialize` + `session/new` only; the session is closed immediately
 * after, success or failure. The throwaway run dir goes through the same
 * `prepareRunEnv` materialisation a real investigation gets, so a failure here
 * reflects the harness's own login state, not a config difference from the
 * real run path.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
} from "@prismalens/config/harness";
import { AcpSession } from "../runner/acp-client.js";
import { prepareRunEnv } from "./investigate.js";
import { readOnlyPolicy } from "./permission.js";

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

export interface HarnessProbeResult {
	id: HarnessId;
	ready: boolean;
	/** "ready", or the harness's own stderr tail / a timeout message. One line. */
	detail: string;
	hard: false;
}

/** `AcpSession`'s failure messages already carry the stderr tail; this just guarantees one line. */
function oneLine(message: string): string {
	return message.replace(/\s*\r?\n\s*/g, " ").trim();
}

/**
 * `initialize` -> `session/new`, no prompt turn, closed immediately. Callers
 * loop harness ids and `await` each in turn — never `Promise.all` — so two
 * probes never race for the same process group or confuse a hang in one
 * harness for a hang in another.
 */
export async function probeHarness(
	harness: HarnessId,
	opts: {
		descriptor?: Pick<
			HarnessDescriptor,
			"binary" | "acpArgs" | "acpEnv" | "configFiles"
		>;
		timeoutMs?: number;
	} = {},
): Promise<HarnessProbeResult> {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[harness];
	const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	const runDir = mkdtempSync(join(tmpdir(), "pl-doctor-"));
	const cwd = join(runDir, "workspace");
	mkdirSync(cwd, { recursive: true });

	try {
		const { env, runEnv } = prepareRunEnv({
			harness,
			descriptor,
			cwd,
			runDir,
			env: process.env,
		});
		const session = new AcpSession({
			command: descriptor.binary,
			args: descriptor.acpArgs(runEnv),
			cwd,
			env,
			// Never exercised: open() sends no prompt turn, so no permission
			// request can ever arrive. Required only because AcpSessionConfig
			// has no optional form of the field.
			permission: readOnlyPolicy,
			initTimeoutMs: timeoutMs,
		});
		try {
			await session.open();
			return { id: harness, ready: true, detail: "ready", hard: false };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const timedOut = /timed out after/.test(message);
			return {
				id: harness,
				ready: false,
				detail: timedOut
					? `no answer in ${Math.max(1, Math.round(timeoutMs / 1000))}s`
					: oneLine(message),
				hard: false,
			};
		} finally {
			await session.close();
		}
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
}
