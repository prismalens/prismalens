// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Harness handshake probe (#630, Unit D on #337). `pl doctor` and the Settings
 * check both call this, and both print `detail` verbatim, so they use the same
 * words. `initialize` + `session/new` only: no prompt turn, no model call.
 *
 * It never says "ready". A logged-out agent can pass the handshake: opencode
 * needs no provider for `session/new`, and claude-agent-acp checks credentials
 * only at turn start. So a pass means "answers ACP", nothing more.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getHarnessProviderKeys,
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
} from "@prismalens/config/harness";
import { AcpRpcError, AcpSession } from "../runner/acp-client.js";
import { prepareRunEnv } from "./investigate.js";
import { readOnlyPolicy } from "./permission.js";

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
/** ACP's auth_required error code. */
const AUTH_REQUIRED = -32000;

export type HarnessProbeOutcome =
	| "answers-acp"
	| "sign-in-needed"
	| "no-answer"
	| "failed-to-start";

export interface HarnessProbeResult {
	id: HarnessId;
	outcome: HarnessProbeOutcome;
	/** The outcome's fixed words, plus the auth method names or the harness's stderr tail when there are any. One line. */
	detail: string;
	hard: false;
}

function oneLine(message: string): string {
	return message.replace(/\s*\r?\n\s*/g, " ").trim();
}

function classify(
	err: unknown,
	session: AcpSession,
	timeoutMs: number,
): Pick<HarnessProbeResult, "outcome" | "detail"> {
	const message = oneLine(err instanceof Error ? err.message : String(err));
	if (
		(err instanceof AcpRpcError && err.code === AUTH_REQUIRED) ||
		/auth_required|authentication required/i.test(message)
	) {
		const methods = session.authMethods
			.map((m) => m.name ?? m.id)
			.filter(Boolean);
		return {
			outcome: "sign-in-needed",
			detail: methods.length
				? `sign in needed (${methods.join(", ")})`
				: "sign in needed",
		};
	}
	if (/timed out after/.test(message)) {
		return {
			outcome: "no-answer",
			detail: `no answer in ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
		};
	}
	// A spawn error, or a harness that exited before it answered the handshake.
	const tail = message.replace(/^failed to start [^:]*:\s*/, "");
	return {
		outcome: "failed-to-start",
		detail: tail ? `failed to start: ${tail}` : "failed to start",
	};
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
			"binary" | "acpArgs" | "acpEnv" | "configFiles" | "sessionMeta"
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
			env: getHarnessProviderKeys(harness, process.env),
		});
		const session = new AcpSession({
			command: descriptor.binary,
			args: descriptor.acpArgs(runEnv),
			cwd,
			env,
			// Never exercised: open() sends no prompt turn, so no permission
			// request can arrive. AcpSessionConfig has no optional form of it.
			permission: readOnlyPolicy,
			sessionMeta: descriptor.sessionMeta?.(),
			initTimeoutMs: timeoutMs,
		});
		// open() times initialize and session/new separately; the probe promises one deadline for both.
		let timer: NodeJS.Timeout | undefined;
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`handshake timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		});
		const opening = session.open();
		opening.catch(() => {});
		try {
			await Promise.race([opening, deadline]);
			return {
				id: harness,
				outcome: "answers-acp",
				detail: "answers ACP",
				hard: false,
			};
		} catch (err) {
			return { id: harness, ...classify(err, session, timeoutMs), hard: false };
		} finally {
			clearTimeout(timer);
			await session.close();
		}
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
}
