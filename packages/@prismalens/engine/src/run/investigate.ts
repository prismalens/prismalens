// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One investigation is one ACP session in a clone (ADR 0002). The harness is a
 * registry row; prismalens writes the per-run config it reads, answers its
 * permission requests, records the stream, and validates the report with one
 * in-session retry. No model call happens here.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
	type HarnessRunEnv,
	type ModelSource,
	resolvePermissionOutcome,
} from "@prismalens/config/harness";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import type {
	CanonicalEvent,
	InvestigationContext,
	OperatorMessageMode,
	RunFidelity,
} from "@prismalens/contracts/schemas";
import { AcpAdapter, mapStopReason } from "../adapter/acp-adapter.js";
import type { RunLimits } from "../launch/types.js";
import { AcpSession, type AcpStreamItem } from "../runner/acp-client.js";
import { type PermissionPolicy, readOnlyPolicyFor } from "./permission.js";
import { buildInvestigationPrompt } from "./prompt.js";
import {
	parseReport,
	retryBudgetKey,
	retryPrompt,
	stampReport,
} from "./report.js";

export interface RunInvestigationOptions {
	runId: string;
	context: InvestigationContext;
	harness: HarnessId;
	/** Tests and the admission script swap the binary; the registry row is the default. */
	descriptor?: Pick<
		HarnessDescriptor,
		| "binary"
		| "acpArgs"
		| "acpEnv"
		| "configFiles"
		| "sessionMeta"
		| "companionBinary"
	> &
		Partial<Pick<HarnessDescriptor, "modelVia">>;
	/** The clone the harness runs in. Never the user's own checkout (ADR 0004 §2). */
	cwd: string;
	/** Per-run directory: harness config, data home, transcript. */
	runDir: string;
	/** Model id in the harness's own format; undefined means the harness default. */
	model?: string;
	/** Where `model` came from; recorded in the run's fidelity. */
	modelSource?: ModelSource;
	/** Env for the child; provider keys ride here. Registry isolation vars are layered on top. */
	env?: NodeJS.ProcessEnv;
	limits?: RunLimits;
	initTimeoutMs?: number;
	promptTimeoutMs?: number;
	permission?: PermissionPolicy;
	/** Operator messages to the live session (#743). */
	steer?: SteerPort;
	/** The operator's brief: appended to the first prompt and recorded as its first message. */
	brief?: string;
	/** Appended to the prompt. Used by the registry admission script to provoke a write; never by the API. */
	promptSuffix?: string;
	/** Harness stderr, chunk by chunk, for the host's logger (#600). */
	onHarnessStderr?: (chunk: string) => void;
	/** A permission the policy allowed without naming its kind; the host logs it at warn. */
	onPolicyWarning?: (message: string) => void;
	/** A value the ACP SDK does not know, passed through; the host logs it at warn (#639). */
	onHarnessDrift?: (message: string) => void;
	/**
	 * A follow-up on a finished run: reopen its session and send `text` (#747).
	 * `heads` are the commits the workspace was rebuilt at.
	 */
	resume?: {
		sessionId: string;
		text: string;
		mode: OperatorMessageMode;
		heads: { name: string; head: string }[];
	};
	/** First event `seq`; a follow-up continues after the stored events. */
	seqStart?: number;
	/** The harness's session id once it is open, and whether it can be loaded again. */
	onSession?: (s: { sessionId: string; loadSession: boolean }) => void;
	signal?: AbortSignal;
}

/**
 * How operator messages reach a live run. Queued messages are drained when the
 * agent's turn ends; a send-now message cancels the current turn first. ACP v1
 * has no mid-turn injection, so a turn boundary is the earliest pause (#743).
 */
export interface SteerPort {
	next(): string | null;
	onNow(deliver: (text: string) => void): () => void;
}

/**
 * The host side of a {@link SteerPort}: `send` answers null once the run has
 * stopped listening, so the caller can refuse instead of dropping the text.
 */
export function createSteerChannel(): {
	port: SteerPort;
	send(text: string, mode: OperatorMessageMode): "queued" | "sent" | null;
} {
	const queue: string[] = [];
	let deliverNow: ((text: string) => void) | null = null;
	let open = true;
	return {
		port: {
			next: () => queue.shift() ?? null,
			onNow(deliver) {
				deliverNow = deliver;
				return () => {
					deliverNow = null;
					open = false;
				};
			},
		},
		send(text, mode) {
			if (!open) return null;
			if (mode === "now" && deliverNow) {
				deliverNow(text);
				return "sent";
			}
			queue.push(text);
			return "queued";
		},
	};
}

export const CANCELLED_MESSAGE = "investigation cancelled";
export function isCancelledError(message: string): boolean {
	return message === CANCELLED_MESSAGE;
}

export function buildRunFidelity(
	harness: HarnessId,
	model?: { id?: string; source?: ModelSource },
): RunFidelity {
	const outcome = resolvePermissionOutcome(harness, "read-only");
	return {
		harness,
		mode: outcome.mode,
		fidelity: outcome.fidelity,
		...(model?.id ? { model: model.id } : {}),
		...(model?.source ? { modelSource: model.source } : {}),
		mechanism: outcome.mechanism,
	};
}

/**
 * The subset `prepareRunEnv` actually reads. Narrower than
 * `RunInvestigationOptions` so a caller with no investigation in hand — the
 * harness doctor probe — can reuse the same config/data-home materialisation
 * without fabricating a `runId` or an `InvestigationContext`.
 */
export type PrepareRunEnvOptions = Pick<
	RunInvestigationOptions,
	"harness" | "descriptor" | "cwd" | "runDir" | "model" | "env"
>;

/** Materialise the per-run config and data dirs the registry row points the harness at. */
export function prepareRunEnv(opts: PrepareRunEnvOptions): {
	env: NodeJS.ProcessEnv;
	runEnv: HarnessRunEnv;
} {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[opts.harness];
	const configDir = join(opts.runDir, "config");
	const dataDir = join(opts.runDir, "home");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(dataDir, { recursive: true });
	const companionPath = descriptor.companionBinary
		? resolveOnPath(descriptor.companionBinary)
		: null;
	const runEnv: HarnessRunEnv = {
		configDir,
		dataDir,
		cwd: opts.cwd,
		...(opts.model ? { model: opts.model } : {}),
		...(companionPath ? { companionPath } : {}),
	};
	for (const [rel, content] of Object.entries(
		descriptor.configFiles?.(runEnv) ?? {},
	)) {
		const path = join(configDir, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
	return {
		env: { ...(opts.env ?? {}), ...descriptor.acpEnv(runEnv) },
		runEnv,
	};
}

export async function* runInvestigation(
	opts: RunInvestigationOptions,
): AsyncGenerator<CanonicalEvent> {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[opts.harness];
	const adapter = new AcpAdapter({
		runId: opts.runId,
		branchId: "run",
		...(opts.seqStart !== undefined ? { seqStart: opts.seqStart } : {}),
	});
	let fidelity = buildRunFidelity(opts.harness, {
		id: opts.model,
		source: opts.modelSource,
	});
	const { env, runEnv } = prepareRunEnv(opts);
	const transcript = join(opts.runDir, "transcript.jsonl");
	const wire = (direction: "in" | "out", line: string): void => {
		try {
			appendFileSync(
				transcript,
				`${JSON.stringify({ t: Date.now(), d: direction, m: line })}\n`,
			);
		} catch {
			// best effort (ADR 0002 §6)
		}
	};

	const session = new AcpSession({
		command: descriptor.binary,
		args: descriptor.acpArgs(runEnv),
		cwd: opts.cwd,
		env,
		limits: opts.limits,
		permission: opts.permission ?? readOnlyPolicyFor({ cwd: opts.cwd }),
		sessionMeta: descriptor.sessionMeta?.(),
		initTimeoutMs: opts.initTimeoutMs,
		promptTimeoutMs: opts.promptTimeoutMs,
		onWire: wire,
		onStderr: opts.onHarnessStderr,
		...(opts.resume ? { resume: { sessionId: opts.resume.sessionId } } : {}),
		onDrift: (drift) => {
			wire("in", JSON.stringify({ drift }));
			opts.onHarnessDrift?.(
				`harness drift: ${drift.method} ${drift.field}=${JSON.stringify(drift.value)} (unknown to ACP SDK 1.4.0; passed through)`,
			);
		},
	});

	let text = "";
	let sawEvidence = false;
	const consume = async function* (
		items: AsyncGenerator<AcpStreamItem>,
	): AsyncGenerator<CanonicalEvent, { stop: string } | { error: string }> {
		for await (const item of items) {
			if (opts.signal?.aborted) session.cancel();
			if (item.kind === "update") {
				const u = item.update;
				if (u.sessionUpdate === "agent_message_chunk") {
					const chunk = u.content;
					text +=
						typeof chunk === "string"
							? chunk
							: ((chunk as { text?: string } | undefined)?.text ?? "");
				}
				const ev = adapter.normalize(u);
				if (ev) {
					if (ev.kind === "tool_result") sawEvidence = true;
					yield ev;
				}
			} else if (item.kind === "permission") {
				wire(
					"in",
					JSON.stringify({
						permission: item.request.toolCall,
						allowed: item.allowed,
						why: item.why,
						warn: item.warn,
					}),
				);
				if (item.warn) opts.onPolicyWarning?.(item.warn);
			} else if (item.kind === "done") {
				const flushed = adapter.flushText();
				if (flushed) yield flushed;
				return { stop: item.stopReason };
			} else {
				const flushed = adapter.flushText();
				if (flushed) yield flushed;
				return { error: item.message };
			}
		}
		return { error: "harness stream ended without a stop reason" };
	};

	const sendNow: string[] = [];
	const unsubscribe = opts.steer?.onNow((line) => {
		sendNow.push(line);
		session.cancel();
	});
	const onAbort = (): void => session.cancel();
	opts.signal?.addEventListener("abort", onAbort, { once: true });

	try {
		await session.open();
		if (session.sessionId) {
			opts.onSession?.({
				sessionId: session.sessionId,
				loadSession: session.loadSession,
			});
		}
		if (opts.resume) wire("in", JSON.stringify({ replayed: session.replayed }));
		if (session.agent.version) {
			fidelity = { ...fidelity, harnessVersion: session.agent.version };
		}
		// An env-supplied model leaves the selector at its default alias, so the
		// selector says nothing about what ran (#733).
		const selectorIsModel = !(descriptor.modelVia === "env" && opts.model);
		if (session.servedModel && selectorIsModel) {
			fidelity = { ...fidelity, servedModel: session.servedModel };
		}
		let outcome: { stop: string } | { error: string };
		if (opts.resume) {
			const { text: line, mode, heads } = opts.resume;
			yield adapter.operatorMessage(line, mode, true, heads);
			outcome = yield* consume(session.prompt(line));
		} else {
			const brief = opts.brief?.trim();
			if (brief) yield adapter.operatorMessage(brief, "queue", true);
			outcome = yield* consume(
				session.prompt(
					buildInvestigationPrompt(opts.context) +
						(brief ? `\n\n${brief}` : "") +
						(opts.promptSuffix ? `\n\n${opts.promptSuffix}` : ""),
				),
			);
		}

		while ("stop" in outcome && !opts.signal?.aborted) {
			const now = sendNow.shift();
			const line = now ?? opts.steer?.next() ?? null;
			if (line === null) break;
			yield adapter.operatorMessage(line, now ? "now" : "queue", true);
			text = "";
			outcome = yield* consume(session.prompt(line));
		}
		unsubscribe?.();
		for (const line of [...sendNow.splice(0), ...drain(opts.steer)]) {
			yield adapter.operatorMessage(line, "queue", false);
		}

		if ("error" in outcome) {
			yield adapter.error(
				opts.signal?.aborted ? CANCELLED_MESSAGE : outcome.error,
			);
			return;
		}
		if (opts.signal?.aborted || outcome.stop === "cancelled") {
			yield adapter.error(CANCELLED_MESSAGE);
			return;
		}
		// A follow-up is chat only: its answer lives in the stream, never in a report (#747).
		if (opts.resume) {
			yield adapter.branchDone(mapStopReason(outcome.stop));
			return;
		}

		let parsed = parseReport(text);
		const spent = { extraction: false, schema: false };
		let retries = 0;
		while (!parsed.ok) {
			const key = retryBudgetKey(parsed);
			if (spent[key]) break;
			spent[key] = true;
			retries += 1;
			text = "";
			const retry = yield* consume(session.prompt(retryPrompt(parsed)));
			if ("error" in retry) {
				yield adapter.error(retry.error);
				return;
			}
			parsed = parseReport(text);
		}
		if (!parsed.ok) {
			yield adapter.error(
				`report did not validate after ${retries === 1 ? "one retry" : "two retries"} (${parsed.reason}: ${parsed.detail})`,
			);
			return;
		}
		if (!sawEvidence) {
			yield adapter.error("investigation produced no evidence: no tool ran");
			return;
		}
		yield adapter.branchDone(mapStopReason(outcome.stop));
		yield adapter.report(stampReport(parsed.report, fidelity));
	} catch (err) {
		yield adapter.error(err instanceof Error ? err.message : String(err));
	} finally {
		unsubscribe?.();
		opts.signal?.removeEventListener("abort", onAbort);
		await session.close();
	}
}

function drain(steer: SteerPort | undefined): string[] {
	const left: string[] = [];
	for (let line = steer?.next(); line; line = steer?.next()) left.push(line);
	return left;
}
