// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One investigation is one ACP session in a clone (ADR 0002). The harness is a
 * registry row; prismalens writes the per-run config it reads, answers its
 * permission requests, records the stream, and validates the report with one
 * in-session retry. No model call happens here.
 */
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
	type HarnessRunEnv,
	type ModelSource,
	type PermissionMode,
	resolvePermissionOutcome,
	SANDBOX_DEFAULT,
} from "@prismalens/config/harness";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import type {
	AttachmentRef,
	CanonicalEvent,
	FollowUpKind,
	InvestigationContext,
	JobAttachment,
	OperatorMessageMode,
	RunFidelity,
} from "@prismalens/contracts/schemas";
import { AcpAdapter, mapStopReason } from "../adapter/acp-adapter.js";
import type { RunLimits } from "../launch/types.js";
import {
	AcpSession,
	type AcpStreamItem,
	type PromptPart,
} from "../runner/acp-client.js";
import { telemetryOrigins } from "./connectors.js";
import { ATTACHED_IMAGE_GUARD, renderAttachment } from "./fence.js";
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
	/** A value of the harness's `thought_level` option; set before every prompt (R4.2). */
	effort?: string;
	/** Files that go with the brief (R4.3). */
	attachments?: JobAttachment[];
	/** What the agent may touch (r4 R4.1); Read-only when absent. The host checks the ceiling. */
	access?: PermissionMode;
	/** The operator's sandbox switch for a harness that has one (Codex); `SANDBOX_DEFAULT` when absent. */
	sandbox?: boolean;
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
		/** `continue` takes a stopped run on to its report (R4.4); `chat` when absent. */
		kind?: FollowUpKind;
		attachments?: JobAttachment[];
		/** The stopped run already ran a tool, so its report has evidence behind it. */
		sawEvidence?: boolean;
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
	next(): SteerLine | null;
	onNow(deliver: (line: SteerLine) => void): () => void;
}

/** One operator message and the files that go with it (R4.3). */
export interface SteerLine {
	text: string;
	attachments?: JobAttachment[];
}

/**
 * The host side of a {@link SteerPort}: `send` answers null once the run has
 * stopped listening, so the caller can refuse instead of dropping the text.
 */
export function createSteerChannel(): {
	port: SteerPort;
	send(
		text: string,
		mode: OperatorMessageMode,
		attachments?: JobAttachment[],
	): "queued" | "sent" | null;
} {
	const queue: SteerLine[] = [];
	let deliverNow: ((line: SteerLine) => void) | null = null;
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
		send(text, mode, attachments) {
			if (!open) return null;
			const line = attachments?.length ? { text, attachments } : { text };
			if (mode === "now" && deliverNow) {
				deliverNow(line);
				return "sent";
			}
			queue.push(line);
			return "queued";
		},
	};
}

export const CANCELLED_MESSAGE = "investigation cancelled";
export function isCancelledError(message: string): boolean {
	return message === CANCELLED_MESSAGE;
}

/** What the conversation shows of a message's files. */
function refsOf(attachments: JobAttachment[] | undefined): AttachmentRef[] {
	return (attachments ?? []).map(({ id, name, mimeType, size }) => ({
		id,
		name,
		mimeType,
		size,
	}));
}

/**
 * A message as ACP content (R4.3): text files fenced as data inside the text,
 * images as `image` blocks after it. Files are read here, never carried as bytes.
 */
export function promptParts(
	text: string,
	attachments: JobAttachment[] = [],
): PromptPart[] {
	const fenced: string[] = [];
	const images: PromptPart[] = [];
	for (const a of attachments) {
		const bytes = readFileSync(a.path);
		if (a.mimeType.startsWith("image/"))
			images.push({
				type: "image",
				data: bytes.toString("base64"),
				mimeType: a.mimeType,
			});
		else fenced.push(renderAttachment(a.name, bytes.toString("utf8")));
	}
	if (images.length) fenced.push(ATTACHED_IMAGE_GUARD);
	const body = [text, ...fenced].filter(Boolean).join("\n\n");
	return [{ type: "text", text: body }, ...images];
}

export function buildRunFidelity(
	harness: HarnessId,
	model?: { id?: string; source?: ModelSource },
	access: PermissionMode = "read-only",
	options: { sandbox?: boolean } = {},
): RunFidelity {
	const outcome = resolvePermissionOutcome(harness, access, options);
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
	| "harness"
	| "descriptor"
	| "cwd"
	| "runDir"
	| "model"
	| "env"
	| "access"
	| "sandbox"
>;

/** `patch` merged into `base`, objects key by key; anything else replaced. */
function deepMerge(base: unknown, patch: unknown): unknown {
	if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
	return out;
}
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

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
	const layer = resolvePermissionOutcome(
		opts.harness,
		opts.access ?? "read-only",
		{ sandbox: opts.sandbox },
	);
	for (const [rel, content] of Object.entries(
		descriptor.configFiles?.(runEnv) ?? {},
	)) {
		const path = join(configDir, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		const patched =
			layer.configPatch && rel.endsWith(".json")
				? JSON.stringify(
						deepMerge(JSON.parse(content), layer.configPatch),
						null,
						2,
					)
				: content;
		writeFileSync(path, patched);
	}
	return {
		env: { ...(opts.env ?? {}), ...descriptor.acpEnv(runEnv), ...layer.env },
		runEnv,
	};
}

export async function* runInvestigation(
	opts: RunInvestigationOptions,
): AsyncGenerator<CanonicalEvent> {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[opts.harness];
	const refusals = new Map<string, string>();
	const adapter = new AcpAdapter({
		runId: opts.runId,
		branchId: "run",
		refusals,
		...(opts.seqStart !== undefined ? { seqStart: opts.seqStart } : {}),
	});
	const access = opts.access ?? "read-only";
	const layer = resolvePermissionOutcome(opts.harness, access, {
		sandbox: opts.sandbox,
	});
	let fidelity = buildRunFidelity(
		opts.harness,
		{ id: opts.model, source: opts.modelSource },
		access,
		{ sandbox: opts.sandbox },
	);
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
		permission:
			opts.permission ??
			readOnlyPolicyFor({
				cwd: opts.cwd,
				level: access,
				allowedOrigins: telemetryOrigins(opts.context),
			}),
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
				const refusedId = item.request.toolCall?.toolCallId;
				if (!item.allowed && item.why && refusedId)
					refusals.set(refusedId, item.why);
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

	const sendNow: SteerLine[] = [];
	const unsubscribe = opts.steer?.onNow((line) => {
		sendNow.push(line);
		session.cancel();
	});
	const onAbort = (): void => session.cancel();
	opts.signal?.addEventListener("abort", onAbort, { once: true });
	const label = HARNESS_REGISTRY[opts.harness]?.label ?? descriptor.binary;
	const modelVia =
		descriptor.modelVia ?? HARNESS_REGISTRY[opts.harness]?.modelVia;

	try {
		await session.open();
		if (session.sessionId) {
			opts.onSession?.({
				sessionId: session.sessionId,
				loadSession: session.loadSession,
			});
		}
		if (opts.resume) wire("in", JSON.stringify({ replayed: session.replayed }));
		// The harness's own mode is the second layer; the gate answers either way.
		if (layer.agentMode && !(await session.setMode(layer.agentMode))) {
			const note = `mode ${layer.agentMode} not offered, gate only`;
			opts.onPolicyWarning?.(note);
			fidelity = { ...fidelity, mechanism: `${fidelity.mechanism}; ${note}` };
		}
		if (session.agent.version) {
			fidelity = { ...fidelity, harnessVersion: session.agent.version };
		}
		// A chosen model goes over the session's own option and must come back as asked,
		// a reopened session included (R4.2); an env-named one the harness read itself (walk f18).
		const chosenModel =
			opts.model && modelVia === "acp" && opts.modelSource !== "env"
				? opts.model
				: null;
		if (chosenModel) {
			const configId = session.modelOptionId;
			const took = !configId
				? null
				: session.servedModel === chosenModel
					? chosenModel
					: await session.setConfigOption(configId, chosenModel);
			yield adapter.sessionConfig("model", chosenModel, took === chosenModel);
			if (took !== chosenModel) {
				const offered = session.models.map((m) => m.id).join(", ");
				yield adapter.error(
					configId
						? `${label} would not switch to ${chosenModel}; it offered ${offered || "no models"}`
						: `${label} offers no model option, so it cannot take ${chosenModel}`,
				);
				return;
			}
		}
		if (session.servedModel && opts.modelSource !== "env") {
			fidelity = { ...fidelity, servedModel: session.servedModel };
		}
		const effortId = opts.effort ? (session.effort?.id ?? null) : null;
		const sendEffort = async (): Promise<boolean> =>
			!opts.effort ||
			(!!effortId &&
				(await session.setConfigOption(effortId, opts.effort)) === opts.effort);
		if (opts.effort) {
			const ok = await sendEffort();
			yield adapter.sessionConfig("effort", opts.effort, ok);
			if (!ok) {
				yield adapter.error(
					`${label} would not take ${opts.effort} effort; it offered ${session.effort?.values.join(", ") || "none"}`,
				);
				return;
			}
			fidelity = { ...fidelity, effort: opts.effort };
		}
		// codex-acp drops the effort after a turn (codex-acp#336), so it is sent again before each later one.
		let turns = 0;
		const turn = async function* (
			parts: PromptPart[],
		): AsyncGenerator<CanonicalEvent, { stop: string } | { error: string }> {
			// A stop during startup found no turn to cancel; prompting now would wait out the prompt timeout.
			if (opts.signal?.aborted) return { stop: "cancelled" };
			if (turns++ > 0 && opts.effort && !(await sendEffort()))
				opts.onPolicyWarning?.(`${label} did not keep ${opts.effort} effort`);
			return yield* consume(session.prompt(parts));
		};

		let outcome: { stop: string } | { error: string };
		if (opts.resume) {
			const { text: line, mode, heads, attachments } = opts.resume;
			yield adapter.operatorMessage(
				line,
				mode,
				true,
				heads,
				refsOf(attachments),
			);
			outcome = yield* turn(promptParts(line, attachments));
		} else {
			const brief = opts.brief?.trim();
			if (brief || opts.attachments?.length)
				yield adapter.operatorMessage(
					brief ?? "",
					"queue",
					true,
					undefined,
					refsOf(opts.attachments),
				);
			outcome = yield* turn(
				promptParts(
					buildInvestigationPrompt(opts.context, access, {
						noNetwork: sandboxWithoutNetwork(opts, access),
					}) +
						(brief ? `\n\n${brief}` : "") +
						(opts.promptSuffix ? `\n\n${opts.promptSuffix}` : ""),
					opts.attachments,
				),
			);
		}

		while ("stop" in outcome && !opts.signal?.aborted) {
			const now = sendNow.shift();
			const line = now ?? opts.steer?.next() ?? null;
			if (line === null) break;
			yield adapter.operatorMessage(
				line.text,
				now ? "now" : "queue",
				true,
				undefined,
				refsOf(line.attachments),
			);
			text = "";
			outcome = yield* turn(promptParts(line.text, line.attachments));
		}
		unsubscribe?.();
		for (const line of [...sendNow.splice(0), ...drain(opts.steer)]) {
			yield adapter.operatorMessage(
				line.text,
				"queue",
				false,
				undefined,
				refsOf(line.attachments),
			);
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
		// Continuing a stopped run finishes it as the run it was, report and all (R4.4).
		if (opts.resume && opts.resume.kind !== "continue") {
			yield adapter.branchDone(mapStopReason(outcome.stop));
			return;
		}
		if (opts.resume?.sawEvidence) sawEvidence = true;

		let parsed = parseReport(text);
		const spent = { extraction: false, schema: false };
		let retries = 0;
		while (!parsed.ok) {
			const key = retryBudgetKey(parsed);
			if (spent[key]) break;
			spent[key] = true;
			retries += 1;
			text = "";
			const retry = yield* turn([{ type: "text", text: retryPrompt(parsed) }]);
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
		yield adapter.report(
			stampReport(withSandboxGap(parsed.report, opts, access), fidelity),
		);
	} catch (err) {
		yield adapter.error(err instanceof Error ? err.message : String(err));
	} finally {
		unsubscribe?.();
		opts.signal?.removeEventListener("abort", onAbort);
		await session.close();
	}
}

/** The operator switched on a harness sandbox that has no network at this level. */
function sandboxWithoutNetwork(
	opts: Pick<RunInvestigationOptions, "harness" | "sandbox">,
	access: PermissionMode,
): boolean {
	return !!(
		(opts.sandbox ?? SANDBOX_DEFAULT) &&
		HARNESS_REGISTRY[opts.harness].sandbox &&
		(access === "read-only" || access === "read-only-tools")
	);
}

/** A sandbox with no network at a read level is named under What we could not check (r4 R4.1 rev). */
function withSandboxGap<R extends { coverage: { notQueried: string[] } }>(
	report: R,
	opts: Pick<RunInvestigationOptions, "harness" | "sandbox">,
	access: PermissionMode,
): R {
	if (!sandboxWithoutNetwork(opts, access)) return report;
	const gap = `${HARNESS_REGISTRY[opts.harness].label}'s sandbox allows no network`;
	if (report.coverage.notQueried.includes(gap)) return report;
	return {
		...report,
		coverage: {
			...report.coverage,
			notQueried: [...report.coverage.notQueried, gap],
		},
	};
}

function drain(steer: SteerPort | undefined): SteerLine[] {
	const left: SteerLine[] = [];
	for (let line = steer?.next(); line; line = steer?.next()) left.push(line);
	return left;
}
