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
	type Placement,
	resolvePermissionOutcome,
	resolvePlacement,
} from "@prismalens/config/harness";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import type {
	CanonicalEvent,
	InvestigationContext,
	RunFidelity,
} from "@prismalens/contracts/schemas";
import { AcpAdapter, mapStopReason } from "../adapter/acp-adapter.js";
import { AcpSession, type AcpStreamItem } from "../runner/acp-client.js";
import type { Sandbox, SandboxLimits } from "../sandbox/types.js";
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
	>;
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
	sandbox?: Sandbox;
	requestedSandbox?: string;
	limits?: SandboxLimits;
	initTimeoutMs?: number;
	promptTimeoutMs?: number;
	permission?: PermissionPolicy;
	/** Operator steering lines; each one cancels the turn and re-prompts in the same session. */
	steer?: () => string | null;
	/** Appended to the prompt. Used by the registry admission script to provoke a write; never by the API. */
	promptSuffix?: string;
	/** Harness stderr, chunk by chunk, for the host's logger (#600). */
	onHarnessStderr?: (chunk: string) => void;
	/** A permission the policy allowed without naming its kind; the host logs it at warn. */
	onPolicyWarning?: (message: string) => void;
	signal?: AbortSignal;
}

export const CANCELLED_MESSAGE = "investigation cancelled";
export function isCancelledError(message: string): boolean {
	return message === CANCELLED_MESSAGE;
}

export function buildRunFidelity(
	harness: HarnessId,
	sandbox?: Sandbox,
	requestedSandbox?: string,
	model?: { id?: string; source?: ModelSource },
	placement: Placement = resolvePlacement(),
): RunFidelity {
	const outcome = resolvePermissionOutcome(harness, "read-only");
	return {
		harness,
		placement,
		mode: outcome.mode,
		fidelity: outcome.fidelity,
		...(model?.id ? { model: model.id } : {}),
		...(model?.source ? { modelSource: model.source } : {}),
		mechanism: sandbox
			? `${outcome.mechanism} · sandbox=${sandbox.id} (${sandbox.fidelity})`
			: outcome.mechanism,
		...(sandbox
			? {
					sandbox: {
						requested: requestedSandbox ?? sandbox.id,
						actual: sandbox.id,
						fidelity: sandbox.fidelity,
					},
				}
			: {}),
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
		placement: resolvePlacement(),
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
	const adapter = new AcpAdapter({ runId: opts.runId, branchId: "run" });
	const fidelity = buildRunFidelity(
		opts.harness,
		opts.sandbox,
		opts.requestedSandbox,
		{ id: opts.model, source: opts.modelSource },
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
		sandbox: opts.sandbox,
		limits: opts.limits,
		permission: opts.permission ?? readOnlyPolicyFor({ cwd: opts.cwd }),
		sessionMeta: descriptor.sessionMeta?.(),
		initTimeoutMs: opts.initTimeoutMs,
		promptTimeoutMs: opts.promptTimeoutMs,
		onWire: wire,
		onStderr: opts.onHarnessStderr,
	});

	let text = "";
	let sawEvidence = false;
	const consume = async function* (
		items: AsyncGenerator<AcpStreamItem>,
	): AsyncGenerator<CanonicalEvent, { stop: string } | { error: string }> {
		for await (const item of items) {
			if (opts.signal?.aborted) {
				session.cancel();
			}
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

	try {
		await session.open();
		let outcome = yield* consume(
			session.prompt(
				buildInvestigationPrompt(opts.context) +
					(opts.promptSuffix ? `\n\n${opts.promptSuffix}` : ""),
			),
		);

		// Operator steering: cancel and re-prompt in the same session, keep streaming.
		for (
			let line = opts.steer?.();
			line && "stop" in outcome;
			line = opts.steer?.()
		) {
			text = "";
			outcome = yield* consume(session.prompt(line));
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
		await session.close();
	}
}
