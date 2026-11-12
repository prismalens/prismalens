// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One investigation is one ACP session in a clone (ADR 0002). The harness is a
 * registry row; prismalens writes the per-run config it reads, answers its
 * permission asks by the run's level, records the stream, and validates the report with one
 * in-session retry. No model call happens here.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	AGENT_REGISTRY,
	type LaunchPolicy,
	planLaunch,
	writeLaunchFiles,
} from "@prismalens/agent-host";
import {
	type AccessLevel,
	DEFAULT_ACCESS_LEVEL,
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
	type HarnessRunEnv,
	levelOfAgentMode,
	type ModelSource,
	modeFidelity,
	NO_MODE_KEY,
	resolveAccess,
} from "@prismalens/config/harness";
import {
	type HarnessLaunch,
	harnessLaunch,
	resolveOnPath,
} from "@prismalens/config/harness-selection";
import {
	type AgentCommand,
	AgentCommandsSchema,
	ASK_TIMEOUT_MS,
	ATTACHMENT_IMAGE_MAX_BYTES,
	ATTACHMENT_TEXT_MAX_BYTES,
	type AttachmentRef,
	attachmentKind,
	type CanonicalEvent,
	type FollowUpKind,
	failureLine,
	type InvestigationContext,
	type InvestigationKind,
	type JobAttachment,
	type JobMessageContext,
	type OperatorMessageMode,
	type PendingAsk,
	PROVIDER_RETRY_ATTEMPTS,
	type PreRunSource,
	QUESTION_ASK_TIMEOUT_MS,
	type RecordedFinding,
	type RunFailure,
	type RunFidelity,
	type RunRuntimeNote,
	type RunUsage,
	type TurnUsage,
} from "@prismalens/contracts/schemas";
import {
	AcpAdapter,
	type AcpUpdate,
	type HarnessToolsTurn,
	mapStopReason,
	parentToolUseOf,
	toolOutputText,
} from "../adapter/acp-adapter.js";
import { prismalensLaunchPolicy } from "../launch/policy.js";
import type { RunLimits } from "../launch/types.js";
import {
	AcpSession,
	type AcpStreamItem,
	type PromptPart,
	type ReopenPath,
} from "../runner/acp-client.js";
import type { ElicitationAsk } from "./elicitation.js";
import { ATTACHED_IMAGE_GUARD, renderAttachment } from "./fence.js";
import { withFindings } from "./findings.js";
import { type GatewayEntry, gatewayOffer } from "./gateway.js";
import { RESTART_NOTE } from "./handoff.js";
import { opencodeUserConfig } from "./local-default.js";
import {
	abortOutcome,
	askWindow,
	denyAllPolicy,
	type HeldOutcome,
	levelPolicy,
	newAskId,
	type PermissionPolicy,
	type RememberedAsk,
} from "./permission.js";
import {
	buildChatPrompt,
	buildInvestigationPrompt,
	COMMAND_LEAD,
	commandLine,
	investigationPromptParts,
	type NewerRun,
	newerRunNote,
} from "./prompt.js";
import {
	PROVIDER_RETRY_NOTE,
	retriesInTurn,
	retryDelayMs,
} from "./provider-failure.js";
import {
	injectedSecrets,
	redactEvent,
	requestedSecrets,
	scrub,
} from "./redact.js";
import {
	parseReport,
	retryBudgetKey,
	retryPrompt,
	stampReport,
} from "./report.js";
import { checkSandbox } from "./sandbox-check.js";
import { parseUsageUpdate, quotaOf } from "./usage.js";

/** What a fresh session is given in place of a session the agent cannot reload (#942). */
export interface FreshSeed {
	text: string;
	/** The agent the run was in; null when it named none. */
	from: string | null;
	carried: string;
	omitted: string | null;
}

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
		Partial<
			Pick<
				HarnessDescriptor,
				"modelVia" | "adapterPackage" | "gatewayDelivery" | "systemPromptVia"
			>
		>;
	/** The snapshot the harness runs in. Never the user's own checkout (ADR 0004 §2). */
	cwd: string;
	/** Several repos: where to start and what to add when the agent takes extra directories, else `cwd` holds them all (#918). */
	roots?: { cwd: string; additional: string[] };
	/** Per-run directory: harness config, data home, transcript. */
	runDir: string;
	/** Model id in the harness's own format; undefined means the harness default. */
	model?: string;
	/** Where `model` came from; recorded in the run's fidelity. */
	modelSource?: ModelSource;
	/** `model` is one the operator added: the row's `customModelEnvKey` lists it at spawn, then the model option takes it (#673 w57). */
	customModel?: boolean;
	/** A value of the harness's `thought_level` option; set before every prompt (R4.2). */
	effort?: string;
	/** Files that go with the brief (R4.3). */
	attachments?: JobAttachment[];
	/**
	 * The run's permission level (#673 w21 ruling 2026-10-10): the agent mode it
	 * sets and how asks are answered. Ask always when absent; a follow-up without
	 * one keeps the reopened session's mode and shows every ask.
	 */
	accessLevel?: AccessLevel;
	/** The user's stored values for this agent from Settings (#907); they win over the host's. */
	env?: NodeJS.ProcessEnv;
	/** Which host variables reach the agent; the user's env minus PrismaLens's own secrets by default (#817). */
	policy?: LaunchPolicy;
	/** The host env the floor reads; `process.env` by default. */
	hostEnv?: NodeJS.ProcessEnv;
	/** Settings → Agent → Binary path; for `local`, its command (#907). */
	binaryPath?: string;
	/** `local` only: its command's arguments. */
	launchArgs?: string[];
	/** What Settings set for this run, recorded as `fidelity.runtime`; names only. */
	runtimeNote?: RunRuntimeNote | null;
	limits?: RunLimits;
	initTimeoutMs?: number;
	promptTimeoutMs?: number;
	/** Shows an ask to the operator; without one nobody can answer, so each that reaches it is denied (#673 w21). */
	permission?: PermissionPolicy;
	/** How long the policy lets an ask wait; the conversation shows when it lapses. */
	askTimeoutMs?: number;
	/** An alert started the run: past reads, every ask is refused at once (#818 w5-29). */
	unattended?: boolean;
	/** Wait for me: a run nobody watches whose asks still wait for a person (#1020). */
	waitForAsks?: boolean;
	/** A schedule's asks a person allowed always; allowed again without a card (#1020). */
	alwaysAllow?: readonly RememberedAsk[];
	/** Whether the agent's own sandbox holds the run's mode here; the report's `enforced` rests on it (#673 w51). */
	sandboxCheck?: typeof checkSandbox;
	/** Operator messages to the live session (#743). */
	steer?: SteerPort;
	/**
	 * Holds an elicitation for the person (#1024); absent, the run declares no
	 * elicitation and every request is declined. An unattended run declines at once.
	 */
	elicit?: (
		askId: string,
		ask: ElicitationAsk,
		ctx: { signal: AbortSignal; timeoutMs: number },
	) => Promise<HeldOutcome>;
	/** How long a question waits (Settings → Agent); QUESTION_ASK_TIMEOUT_MS when absent. */
	questionTimeoutMs?: number;
	/** The agent's advertised commands, validated, each time it sends them (#1024). */
	onCommands?: (commands: AgentCommand[]) => void;
	/**
	 * A folder only this run may read, added as an extra directory for an agent that
	 * takes them; a file too big to inline is copied there and linked (#1024).
	 */
	attachmentsDir?: string;
	/** The first message's quotes and references, and the text they add (#1024). */
	messageContext?: JobMessageContext;
	/** The operator's brief: appended to the first prompt and recorded as its first message. */
	brief?: string;
	/** `chat`: `brief` is a person's message, the whole first turn; the run ends with no report (#673). */
	kind?: InvestigationKind;
	/** Appended to the prompt. Used by the registry admission script to provoke a write; never by the API. */
	promptSuffix?: string;
	/** Harness stderr, chunk by chunk, for the host's logger (#600). */
	onHarnessStderr?: (chunk: string) => void;
	/** A permission the policy allowed without naming its kind; the host logs it at warn. */
	onPolicyWarning?: (message: string) => void;
	/** A value the ACP SDK does not know, passed through; the host logs it at warn (#639). */
	onHarnessDrift?: (message: string) => void;
	/** Each ACP `usage_update` the harness sends; never called for a harness that sends none. */
	onUsage?: (usage: RunUsage) => void;
	/** Waits out a short provider retry inside the turn (#1101); injectable so tests need no real wait. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/** The clock a retry's time is read from; injectable beside `sleep`. */
	now?: () => Date;
	/**
	 * A follow-up on a finished run: reopen its session and send `text` (#747).
	 * `heads` are the commits the workspace was rebuilt at. Without a
	 * `sessionId` a fresh session starts, seeded with `handoff`.
	 */
	resume?: {
		sessionId?: string;
		handoff?: string;
		/** The tool call ids the stored run holds; a reopened load drops any update carrying one (#942). */
		known?: () => Promise<Iterable<string>>;
		/** The stored conversation for a fresh session, when the agent's load is known broken (#942). */
		fresh?: () => Promise<FreshSeed>;
		/** A restart cut the run off; a reopened session is told so too. */
		afterRestart?: boolean;
		/** Recorded on the follow-up's first message. */
		via?: Extract<CanonicalEvent, { kind: "operator_message" }>["via"];
		text: string;
		mode: OperatorMessageMode;
		heads: { name: string; head: string }[];
		/** `continue` takes a stopped run on to its report (R4.4); `chat` when absent. */
		kind?: FollowUpKind;
		attachments?: JobAttachment[];
		/** The stopped run already ran a tool, so its report has evidence behind it. */
		sawEvidence?: boolean;
		/** Its quotes and references, and the text they add (#1024). */
		context?: JobMessageContext;
		/** A newer run on the incident saw other commits; the prompt says so (#673 w27). */
		newer?: NewerRun;
		/**
		 * Compact with the agent's own command first (#1024); `only` sends no
		 * message after it. `before` is the context the row last recorded.
		 */
		compact?: {
			command: string;
			instructions?: string;
			only?: boolean;
			before?: number;
		};
		/** The line's queue id; with `compact` the line is recorded as queued before it (#1024). */
		messageId?: string;
		/** Queued messages the line carries, acknowledged on its `operator_message` (#1024). */
		delivers?: string[];
	};
	/** First event `seq`; a follow-up continues after the stored events. */
	seqStart?: number;
	/** The harness's session id once it is open, and whether it can be loaded again. */
	onSession?: (s: { sessionId: string; loadSession: boolean }) => void;
	/** The harness's pid once spawned (#981). */
	onSpawn?: (pid: number | undefined) => void;
	/** After a follow-up's turn: how it reopened its session, what it dropped as replay, and how long the reopen took (#942). */
	onReopen?: (r: { path: ReopenPath; replayed: number; ms: number }) => void;
	/** PrismaLens's MCP gateway for this run; offered only to an agent that takes HTTP MCP servers (#848). */
	gateway?: GatewayEntry;
	/** Settings → Agent → Advanced: sub-agent depth and concurrency, through the agent's own keys (#1024 spec B). */
	subagentLimits?: { depth?: number; concurrency?: number };
	/** Stops one sub-agent the agent granted cancel for; the handler answers false otherwise (#1025). */
	subagents?: {
		onCancel(handler: (sessionId: string) => boolean): () => void;
	};
	/**
	 * Values the user gave this thread through `secret_request` (#1024 spec B): redacted
	 * from every event, the transcript and stderr whatever their length or name.
	 */
	secrets?: readonly string[];
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
	/** Lines queued since the last call and not yet taken, to record as waiting (#820). */
	queued?(): SteerLine[];
	/** Told when a line is queued, so a turn waiting on an ask records it at once (#820). */
	onQueued?(listener: () => void): () => void;
	/** Queued lines edited (`text`) or withdrawn (`null`) since the last call (#1024). */
	changes?(): { id: string; text: string | null }[];
}

/** One operator message and the files that go with it (R4.3). */
export interface SteerLine {
	text: string;
	attachments?: JobAttachment[];
	/** The id the API gave a queued line; its events carry it (#820). */
	id?: string;
	/** Its quotes and references, and the text they add for the agent (#1024). */
	context?: JobMessageContext;
}

/** A message's text as the agent receives it: the quotes and references it carries after it. */
export function withAddendum(
	text: string,
	context: JobMessageContext | undefined,
): string {
	return context?.addendum ? `${text}\n\n${context.addendum}` : text;
}

/** The agent's `available_commands_update`, validated; null when it does not fit (#1024). */
export function parseAgentCommands(update: unknown): AgentCommand[] | null {
	const list = (update as { availableCommands?: unknown })?.availableCommands;
	if (!Array.isArray(list)) return null;
	const mapped = list.slice(0, 200).map((c) => {
		const o = (c ?? {}) as Record<string, unknown>;
		const hint = (o.input as { hint?: unknown } | null | undefined)?.hint;
		return {
			name: typeof o.name === "string" ? o.name : "",
			description:
				typeof o.description === "string" ? o.description.slice(0, 200) : "",
			...(typeof hint === "string" && hint
				? { inputHint: hint.slice(0, 200) }
				: {}),
		};
	});
	const parsed = AgentCommandsSchema.safeParse(
		mapped.filter((c) => c.name && c.name.length <= 64),
	);
	return parsed.success ? parsed.data : null;
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
		id?: string,
		context?: JobMessageContext,
	): "queued" | "sent" | null;
	/**
	 * Edit (`text`) or withdraw (`null`) a queued line before the run claims it (#1024);
	 * null once it was claimed or never queued. Claiming is `next`, on the same tick.
	 */
	change(id: string, text: string | null): "edited" | "withdrawn" | null;
} {
	const queue: SteerLine[] = [];
	const unrecorded = new Set<SteerLine>();
	const changed: { id: string; text: string | null }[] = [];
	let deliverNow: ((line: SteerLine) => void) | null = null;
	let onQueued: (() => void) | null = null;
	let open = true;
	return {
		port: {
			next: () => {
				const line = queue.shift() ?? null;
				if (line) unrecorded.delete(line);
				return line;
			},
			onNow(deliver) {
				deliverNow = deliver;
				return () => {
					deliverNow = null;
					open = false;
				};
			},
			queued: () => {
				const lines = queue.filter((l) => unrecorded.has(l));
				unrecorded.clear();
				return lines;
			},
			onQueued(listener) {
				onQueued = listener;
				return () => {
					onQueued = null;
				};
			},
			changes: () => changed.splice(0),
		},
		change(id, text) {
			const at = queue.findIndex((l) => l.id === id);
			if (!open || at < 0) return null;
			const line = queue[at] as SteerLine;
			if (text === null) queue.splice(at, 1);
			else line.text = text;
			// A line not yet recorded as queued is recorded as it now stands, or not at all.
			if (unrecorded.has(line)) {
				if (text === null) unrecorded.delete(line);
			} else {
				changed.push({ id, text });
				onQueued?.();
			}
			return text === null ? "withdrawn" : "edited";
		},
		send(text, mode, attachments, id, context) {
			if (!open) return null;
			const line: SteerLine = {
				text,
				...(attachments?.length ? { attachments } : {}),
				...(id ? { id } : {}),
				...(context ? { context } : {}),
			};
			if (mode === "now" && deliverNow) {
				deliverNow(line);
				return "sent";
			}
			queue.push(line);
			if (id) {
				unrecorded.add(line);
				onQueued?.();
			}
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
	link: { dir: string | null } = { dir: null },
): PromptPart[] {
	const fenced: string[] = [];
	const images: PromptPart[] = [];
	const links: PromptPart[] = [];
	for (const a of attachments) {
		if (!inlines(a)) {
			links.push(attachmentLink(a, link.dir));
			continue;
		}
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
	if (links.length) fenced.push(LINKED_FILES_NOTE);
	const body = [text, ...fenced].filter(Boolean).join("\n\n");
	return [{ type: "text", text: body }, ...images, ...links];
}

const LINKED_FILES_NOTE =
	"Some attached files are linked below instead of inlined. A file:// link is in a folder you may read; a prismalens://attachment/<id> link is read with the attachment_read tool, in chunks.";

/** An image to 4 MB or a text file to 256 KB goes inline; anything else is linked (#1024). */
function inlines(a: JobAttachment): boolean {
	const kind = attachmentKind({ name: a.name, type: a.mimeType });
	if (kind === "image") return a.size <= ATTACHMENT_IMAGE_MAX_BYTES;
	if (kind === "text") return a.size <= ATTACHMENT_TEXT_MAX_BYTES;
	return false;
}

/** The run-scoped folder's copy when the agent reads extra directories, else the tool's URI. */
function attachmentLink(a: JobAttachment, dir: string | null): PromptPart {
	const head = { name: a.name, mimeType: a.mimeType, size: a.size };
	if (!dir) {
		return {
			type: "resource_link",
			uri: `prismalens://attachment/${a.id}`,
			...head,
		};
	}
	mkdirSync(dir, { recursive: true });
	const target = join(dir, `${a.id}-${a.name.replace(/[^\w.-]+/g, "_")}`);
	copyFileSync(a.path, target);
	return { type: "resource_link", uri: pathToFileURL(target).href, ...head };
}

/** `mode` is the id the agent reported as current, else the one asked for (#673 w21); `cooperative` until its sandbox is checked. */
export function buildRunFidelity(
	harness: HarnessId,
	model: { id?: string; source?: ModelSource } | undefined,
	mode: string,
	mechanism = "agent",
	runtime?: RunRuntimeNote | null,
): RunFidelity {
	return {
		harness,
		mode,
		fidelity: modeFidelity(undefined),
		...(model?.id ? { model: model.id } : {}),
		...(model?.source ? { modelSource: model.source } : {}),
		mechanism,
		...(runtime ? { runtime } : {}),
	};
}

/**
 * The level a run ran at, from the mode the agent reported: the asked level
 * when it runs that level's mode, else the level whose mode it runs.
 */
export function ranLevel(
	harness: HarnessId,
	asked: AccessLevel | undefined,
	reported: string | null,
): AccessLevel | undefined {
	if (!asked) return levelOfAgentMode(harness, reported) ?? undefined;
	const mode = resolveAccess(harness, asked).mode ?? null;
	if (mode === null || reported === mode) return asked;
	return levelOfAgentMode(harness, reported) ?? undefined;
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
	| "accessLevel"
	| "customModel"
	| "binaryPath"
	| "launchArgs"
	| "gateway"
	| "policy"
	| "hostEnv"
	| "subagentLimits"
>;

/** Materialise the per-run config and data dirs, and the child's env, from the agent-host launch plan (#916). */
export function prepareRunEnv(opts: PrepareRunEnvOptions): {
	env: Record<string, string>;
	args: string[];
	runEnv: HarnessRunEnv;
	launch: HarnessLaunch;
} {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[opts.harness];
	const companionPath = descriptor.companionBinary
		? (opts.binaryPath ?? resolveOnPath(descriptor.companionBinary))
		: null;
	// A swapped-in binary (tests, admission) runs as given; a row nobody installed fails to start.
	const launch = (!opts.descriptor &&
		harnessLaunch(descriptor, {
			...(opts.binaryPath ? { binaryPath: opts.binaryPath } : {}),
			...(opts.launchArgs ? { launchArgs: opts.launchArgs } : {}),
		})) || {
		command: descriptor.companionBinary
			? descriptor.binary
			: (opts.binaryPath ?? descriptor.binary),
		args: descriptor.companionBinary ? [] : (opts.launchArgs ?? []),
		env: {},
		shipped: false,
	};
	const host = opts.hostEnv ?? process.env;
	const stored = Object.fromEntries(
		Object.entries(opts.env ?? {}).filter(
			(e): e is [string, string] => e[1] !== undefined,
		),
	);
	const customKey = HARNESS_REGISTRY[opts.harness]?.customModelEnvKey;
	const plan = planLaunch({
		agent: opts.harness,
		...(opts.accessLevel ? { level: opts.accessLevel } : {}),
		policy: opts.policy ?? prismalensLaunchPolicy(),
		launch: {
			command: launch.command,
			args: launch.args,
			env: launch.env,
			shipped: launch.shipped,
			...(companionPath ? { companionPath } : {}),
		},
		cwd: opts.cwd,
		runDir: opts.runDir,
		hostEnv: host,
		stored,
		...(opts.customModel && opts.model && customKey
			? { overrides: { [customKey]: opts.model } }
			: {}),
		...(opts.harness === "opencode"
			? { userConfig: opencodeUserConfig({ ...host, ...stored }) }
			: {}),
		...(opts.gateway
			? {
					gateway: {
						url: opts.gateway.url,
						token: opts.gateway.token,
						name: opts.gateway.serverName,
					},
				}
			: {}),
		...(opts.subagentLimits ? { subagents: opts.subagentLimits } : {}),
		descriptor: { ...AGENT_REGISTRY[opts.harness], ...descriptor },
	});
	writeLaunchFiles(plan);
	return { env: plan.env, args: plan.args, runEnv: plan.runEnv, launch };
}

/** How long a run waits after `session/new` for the agent's first gateway request. */
const GATEWAY_CONFIRM_MS = 5_000;

export async function* runInvestigation(
	opts: RunInvestigationOptions,
): AsyncGenerator<CanonicalEvent> {
	const secrets = requestedSecrets(opts.secrets);
	if (!secrets.length) {
		yield* runSession(opts);
		return;
	}
	// A requested secret never reaches an event, even when the agent echoes it (#1024 spec B).
	const stderr = opts.onHarnessStderr;
	const scrubbed: RunInvestigationOptions = {
		...opts,
		...(stderr ? { onHarnessStderr: (c) => stderr(scrub(c, secrets)) } : {}),
	};
	for await (const ev of runSession(scrubbed)) yield redactEvent(ev, secrets);
}

async function* runSession(
	opts: RunInvestigationOptions,
): AsyncGenerator<CanonicalEvent> {
	const descriptor = opts.descriptor ?? HARNESS_REGISTRY[opts.harness];
	const adapter = new AcpAdapter({
		runId: opts.runId,
		branchId: "run",
		...(opts.seqStart !== undefined ? { seqStart: opts.seqStart } : {}),
	});
	// A follow-up on a run from before permission levels keeps the session's mode and shows every ask (#673 w21).
	let keepMode = !!opts.resume?.sessionId && !opts.accessLevel;
	const level = opts.accessLevel ?? DEFAULT_ACCESS_LEVEL;
	const access = resolveAccess(opts.harness, level);
	const askedMode = access.mode ?? null;
	let fidelity = buildRunFidelity(
		opts.harness,
		{ id: opts.model, source: opts.modelSource },
		askedMode ?? NO_MODE_KEY,
		access.mechanism,
		opts.runtimeNote,
	);
	const { env, args, launch } = prepareRunEnv({
		...opts,
		...(keepMode ? { accessLevel: undefined } : { accessLevel: level }),
	});
	const keyed = apiKeyIn(env, HARNESS_REGISTRY[opts.harness]?.providerKeys);
	const transcript = join(opts.runDir, "transcript.jsonl");
	// session/new carries the gateway bearer; the transcript never stores it (#848).
	// Nor the GitHub token values the agent's env holds (#1020).
	const hidden = [
		...injectedSecrets(env, [opts.gateway?.token]),
		...requestedSecrets(opts.secrets),
	];
	const wire = (direction: "in" | "out", line: string): void => {
		let m = line;
		for (const s of hidden) m = m.replaceAll(s, "[redacted]");
		try {
			appendFileSync(
				transcript,
				`${JSON.stringify({ t: Date.now(), d: direction, m })}\n`,
			);
		} catch {
			// best effort (ADR 0002 §6)
		}
	};

	const offer = opts.gateway
		? gatewayOffer(opts.gateway, descriptor.gatewayDelivery)
		: null;
	// The brief rides the session, new and load alike, so the first prompt carries only the turn (#817).
	const brief =
		descriptor.systemPromptVia === "claude-meta" &&
		opts.kind !== "chat" &&
		(opts.context.alerts.length > 0 || opts.context.mode === "service-check")
			? investigationPromptParts(opts.context, { level }).brief
			: null;
	const investigationPrompt = (
		o: Parameters<typeof buildInvestigationPrompt>[1],
	) =>
		brief
			? investigationPromptParts(opts.context, o).turn
			: buildInvestigationPrompt(opts.context, o);
	// The run's ask policy decides: an unattended run declines at once (#1024).
	const elicit = (
		ask: ElicitationAsk,
		ctx: { askId: string; signal: AbortSignal },
	): { timeoutMs: number; outcome: Promise<HeldOutcome> } | HeldOutcome => {
		if ((opts.unattended && !opts.waitForAsks) || !opts.elicit)
			return { outcome: "unattended" };
		const timeoutMs = askWindow(
			opts.questionTimeoutMs ?? QUESTION_ASK_TIMEOUT_MS,
			opts.limits?.wallClockMs,
			Date.now() - spawnedAt,
		).timeoutMs;
		return {
			timeoutMs,
			outcome: opts.elicit(ctx.askId, ask, { signal: ctx.signal, timeoutMs }),
		};
	};
	const linkOpts = () => ({
		dir:
			opts.attachmentsDir && session.takesDirectories
				? opts.attachmentsDir
				: null,
	});
	// The launcher's wall clock starts at spawn, in open().
	let spawnedAt = Date.now();
	const session = new AcpSession({
		command: launch.command,
		args,
		cwd: opts.cwd,
		...(opts.roots || opts.attachmentsDir
			? {
					roots: {
						cwd: opts.roots?.cwd ?? opts.cwd,
						additional: [
							...(opts.roots?.additional ?? []),
							...(opts.attachmentsDir ? [opts.attachmentsDir] : []),
						],
					},
				}
			: {}),
		...(opts.elicit ? { elicit } : {}),
		env,
		limits: opts.limits,
		...(opts.onSpawn ? { onSpawn: opts.onSpawn } : {}),
		permission: levelPolicy(
			keepMode ? "supervised" : level,
			{ policy: opts.permission ?? denyAllPolicy },
			{
				unattended: !!opts.unattended,
				...(opts.waitForAsks ? { waitForAsks: true } : {}),
				...(opts.gateway ? { gateway: opts.gateway } : {}),
				...(opts.alwaysAllow?.length ? { remembered: opts.alwaysAllow } : {}),
			},
		),
		// An ask never outlives the launcher's kill: its window ends a minute before (#673 w21).
		askWindow: () =>
			askWindow(
				opts.askTimeoutMs ?? ASK_TIMEOUT_MS,
				opts.limits?.wallClockMs,
				Date.now() - spawnedAt,
			),
		sessionMeta: brief
			? { ...descriptor.sessionMeta?.(), systemPrompt: { append: brief } }
			: descriptor.sessionMeta?.(),
		initTimeoutMs: opts.initTimeoutMs,
		promptTimeoutMs: opts.promptTimeoutMs,
		onWire: wire,
		onStderr: opts.onHarnessStderr,
		...(opts.resume?.sessionId
			? {
					resume: {
						sessionId: opts.resume.sessionId,
						...(opts.resume.known ? { known: opts.resume.known } : {}),
						fresh: !!opts.resume.fresh,
					},
				}
			: {}),
		...(offer ? { mcpServers: offer.pick } : {}),
		onDrift: (drift) => {
			wire("in", JSON.stringify({ drift }));
			opts.onHarnessDrift?.(
				`harness drift: ${drift.method} ${drift.field}=${JSON.stringify(drift.value)} (unknown to ACP SDK 1.9.0; passed through)`,
			);
		},
	});

	let text = "";
	let sawEvidence = false;
	const ownCalls = new Set<string>();
	/** The context the agent last reported, and whether PrismaLens's own compact turn runs (#1024). */
	let lastUsed: number | undefined = opts.resume?.compact?.before;
	/** The session's cumulative cost and model, as the agent last reported them (#1101). */
	let lastCost: RunUsage["cost"];
	let lastModel: string | undefined;
	let lastQuota: string | null = null;
	let compacting = false;
	let autoCompactFrom: number | undefined;
	/** The run's mode once set; the agent may not leave it (#673 w7-4). */
	let heldMode: string | null = null;
	let lastCall: { title?: string; toolCallId?: string } | null = null;
	/** A mode the agent would not leave: refused once, not again on every update. */
	let stuckIn: string | null = null;
	/** Asks the agent back into the run's mode and shows the refusal; the run goes on either way. */
	const holdMode = async function* (
		held: string,
	): AsyncGenerator<CanonicalEvent> {
		const left = session.currentMode;
		for (const flushed of adapter.flush()) yield flushed;
		const back = (await session.setMode(held)) && session.currentMode === held;
		stuckIn = back ? null : left;
		wire("in", JSON.stringify({ modeHeld: held, left, back }));
		yield adapter.permissionAnswer(newAskId(), "mode_kept", {
			title: lastCall?.title ?? `Switch to ${left}`,
			...(lastCall?.toolCallId ? { toolCallId: lastCall.toolCallId } : {}),
			kind: "switch_mode",
		});
	};
	const consume = async function* (
		items: AsyncGenerator<AcpStreamItem>,
	): AsyncGenerator<CanonicalEvent, TurnEnd> {
		for await (const item of items) {
			if (opts.signal?.aborted) session.cancel(opts.signal.reason);
			if (item.kind === "update") {
				const u = item.update;
				// A sub-agent's words and state are its own: never the report's text, the run's usage or mode (#1025).
				const main = !item.sessionId && !parentToolUseOf(u._meta);
				if (main && u.sessionUpdate === "agent_message_chunk") {
					const chunk = u.content;
					text +=
						typeof chunk === "string"
							? chunk
							: ((chunk as { text?: string } | undefined)?.text ?? "");
				}
				if (main && u.sessionUpdate === "usage_update") {
					const usage = parseUsageUpdate(u);
					if (usage) {
						lastUsed = usage.used;
						if (usage.cost) lastCost = usage.cost;
						opts.onUsage?.(usage);
					}
					const model = (u._meta as Record<string, unknown> | undefined)?.[
						"_claude/model"
					];
					if (typeof model === "string" && model) lastModel = model;
					// A window's state is recorded only when it changes (#1101).
					const quota = quotaOf(u._meta);
					const key = quota ? JSON.stringify(quota) : null;
					if (quota && key !== lastQuota) {
						lastQuota = key;
						yield adapter.agentQuota(quota);
					}
				}
				// The agent compacted on its own; PrismaLens's own compact turn records itself.
				if (u.sessionUpdate === "compaction_update" && !compacting) {
					const status = (u as { status?: unknown }).status;
					const flushed = adapter.flushText();
					if (flushed) yield flushed;
					if (status === "in_progress") {
						autoCompactFrom = lastUsed;
						yield adapter.compaction("started", "agent_auto", {
							...(lastUsed !== undefined ? { before: lastUsed } : {}),
						});
					} else if (status === "completed" || status === "failed") {
						yield adapter.compaction(
							status === "completed" ? "completed" : "failed",
							"agent_auto",
							{
								...(autoCompactFrom !== undefined
									? { before: autoCompactFrom }
									: {}),
								...(lastUsed !== undefined && lastUsed !== autoCompactFrom
									? { after: lastUsed }
									: {}),
							},
						);
						autoCompactFrom = undefined;
					}
				}
				if (u.sessionUpdate === "tool_call")
					lastCall = { title: u.title, toolCallId: u.toolCallId };
				if (u.toolCallId && opts.gateway?.sawOutput) {
					// A call to PrismaLens's own tools carries the quote it records, so it never anchors one (#930).
					if (namesServer(u, opts.gateway.serverName))
						ownCalls.add(u.toolCallId);
					const done =
						u.sessionUpdate === "tool_call_update" ||
						u.status === "completed" ||
						u.status === "failed";
					const out = done ? toolOutputText(u) : "";
					if (out && !ownCalls.has(u.toolCallId))
						opts.gateway.sawOutput(u.toolCallId, out);
				}
				if (
					main &&
					u.sessionUpdate === "available_commands_update" &&
					opts.onCommands
				) {
					const commands = parseAgentCommands(u);
					if (commands) opts.onCommands(commands);
				}
				for (const ev of adapter.events(u, item.sessionId)) {
					if (ev.kind === "tool_result") sawEvidence = true;
					yield ev;
				}
				// An agent can switch with no ask, so the mode update is the only sign (#673 w7-4).
				if (
					heldMode &&
					!item.sessionId &&
					(u.sessionUpdate === "current_mode_update" ||
						u.sessionUpdate === "config_option_update") &&
					session.currentMode !== heldMode &&
					session.currentMode !== stuckIn
				)
					yield* holdMode(heldMode);
			} else if (item.kind === "permission_asked") {
				openAsks.add(item.askId);
				for (const flushed of adapter.flush()) yield flushed;
				const window = item.window ?? {
					timeoutMs: opts.askTimeoutMs ?? ASK_TIMEOUT_MS,
					clamped: false,
				};
				yield adapter.permissionAsk(
					item.askId,
					item.request.toolCall,
					new Date(Date.now() + window.timeoutMs),
					window.clamped,
					item.request.sessionId,
				);
			} else if (item.kind === "permission") {
				wire(
					"in",
					JSON.stringify({
						permission: item.request.toolCall,
						askId: item.askId,
						allowed: item.allowed,
						outcome: item.outcome,
						why: item.why,
						warn: item.warn,
					}),
				);
				if (item.warn) opts.onPolicyWarning?.(item.warn);
				if (item.sync) {
					for (const flushed of adapter.flush()) yield flushed;
				}
				openAsks.delete(item.askId);
				yield adapter.permissionAnswer(
					item.askId,
					item.outcome,
					item.sync ? item.request.toolCall : undefined,
				);
			} else if (item.kind === "elicit_asked") {
				const flushed = adapter.flushText();
				if (flushed) yield flushed;
				yield adapter.askOpened(elicitedAsk(item));
			} else if (item.kind === "elicit_closed") {
				yield adapter.askClosed(
					item.askId,
					item.closed.outcome,
					"answer" in item.closed ? item.closed.answer : undefined,
				);
			} else if (item.kind === "nudge") {
				yield* recordQueued();
			} else if (item.kind === "harness_tool_call") {
				if (opts.gateway && shown(`call:${item.call.callId ?? item.call.at}`))
					yield adapter.harnessToolCall(
						opts.gateway.serverName,
						item.call,
						toolsTurn,
					);
			} else if (item.kind === "harness_finding") {
				if (shown(findingKey(item.finding)))
					yield adapter.findingRecorded(item.finding);
			} else if (item.kind === "harness_artifact") {
				if (!shownPages.has(item.artifact.id)) {
					shownPages.add(item.artifact.id);
					yield adapter.artifactPublished(item.artifact);
				}
			} else if (item.kind === "done") {
				for (const flushed of adapter.flush()) yield flushed;
				return {
					stop: item.stopReason,
					...(item.usage ? { usage: item.usage } : {}),
				};
			} else {
				for (const flushed of adapter.flush()) yield flushed;
				return {
					error: item.message,
					...(item.failure ? { failure: item.failure } : {}),
				};
			}
		}
		return { error: "harness stream ended without a stop reason" };
	};

	const sendNow: SteerLine[] = [];
	const openAsks = new Set<string>();
	const recordQueued = function* (): Generator<CanonicalEvent> {
		for (const line of opts.steer?.queued?.() ?? [])
			if (line.id)
				yield adapter.messageQueued(
					line.id,
					line.text,
					refsOf(line.attachments),
					line.context,
				);
		for (const c of opts.steer?.changes?.() ?? [])
			yield adapter.messageChanged(c.id, c.text);
	};
	const elicitedAsk = (
		item: Extract<AcpStreamItem, { kind: "elicit_asked" }>,
	): PendingAsk => ({
		askId: item.askId,
		threadId: opts.runId,
		kind: item.ask.kind,
		requiresHost: false,
		source: adapter.askSource(item.sessionId),
		title: item.ask.title,
		openedAt: new Date().toISOString(),
		...(item.expiresAt ? { expiresAt: item.expiresAt.toISOString() } : {}),
		...(item.ask.kind === "question"
			? { questions: item.ask.questions }
			: { input: { schema: item.ask.schema } }),
	});
	/**
	 * What the run leaves behind on any end (#820): an ask it never heard back on
	 * reads stopped, and a message it never read, not delivered.
	 */
	const shownPages = new Set<string>();
	const seen = new Set<string>();
	/** True the first time `key` is seen this run. */
	const shown = (key: string): boolean => !seen.has(key) && !!seen.add(key);
	// The anchor is in the key so evidence that anchors after its first emission shows again.
	const findingKey = (f: RecordedFinding) =>
		`finding:${f.type}:${f.id}:${f.at}:${JSON.stringify(f.type === "evidence" ? (f.anchor ?? null) : null)}`;
	const toolsSummary = function* (): Generator<CanonicalEvent> {
		unCalled?.();
		unFound?.();
		unPublished?.();
		opts.gateway?.closeRecording?.();
		// What was acknowledged after the turn's last item was read is still recorded, once.
		const gw = opts.gateway;
		for (const call of gw?.callLog?.() ?? [])
			if (gw && call.callId && shown(`call:${call.callId}`))
				yield adapter.harnessToolCall(gw.serverName, call, toolsTurn);
		const found = gw?.findings?.();
		for (const f of [
			...(found?.evidence ?? []).map((e) => ({
				type: "evidence" as const,
				...e,
			})),
			...(found?.hypotheses ?? []).map((h) => ({
				type: "hypothesis" as const,
				...h,
			})),
		])
			if (shown(findingKey(f))) yield adapter.findingRecorded(f);
		for (const page of gw?.artifacts?.() ?? [])
			if (!shownPages.has(page.id)) {
				shownPages.add(page.id);
				yield adapter.artifactPublished(page);
			}
		if (offer && opts.gateway && !summarized) {
			summarized = true;
			yield adapter.harnessTools(
				opts.gateway.serverName,
				toolsTurn,
				opts.gateway.connected(),
				opts.gateway.calls(),
			);
		}
	};
	const leftovers = function* (tools = true): Generator<CanonicalEvent> {
		for (const askId of openAsks)
			yield adapter.permissionAnswer(askId, abortOutcome(opts.signal));
		openAsks.clear();
		unsubscribe?.();
		unQueued?.();
		unCancel?.();
		yield* adapter.endSubagents(!!opts.signal?.aborted);
		if (tools) yield* toolsSummary();
		for (const line of [...sendNow.splice(0), ...drain(opts.steer)])
			yield adapter.operatorMessage(
				line.text,
				"queue",
				false,
				undefined,
				refsOf(line.attachments),
				undefined,
				line.id,
				undefined,
				line.context,
			);
	};
	const unsubscribe = opts.steer?.onNow((line) => {
		sendNow.push(line);
		session.cancel();
	});
	const unQueued = opts.steer?.onQueued?.(() => session.nudge());
	const unCancel = opts.subagents?.onCancel((sessionId) =>
		session.cancelSubagent(sessionId),
	);
	const toolsTurn: HarnessToolsTurn = opts.resume ? "follow-up" : "first";
	let summarized = false;
	const unCalled = opts.gateway?.onCall((c) =>
		session.inject({ kind: "harness_tool_call", call: c }),
	);
	const unFound = opts.gateway?.onFinding?.((finding) =>
		session.inject({ kind: "harness_finding", finding }),
	);
	const unPublished = opts.gateway?.onArtifact?.((artifact) =>
		session.inject({ kind: "harness_artifact", artifact }),
	);
	const onAbort = (): void => session.cancel(opts.signal?.reason);
	opts.signal?.addEventListener("abort", onAbort, { once: true });
	const label = HARNESS_REGISTRY[opts.harness]?.label ?? descriptor.binary;
	const modelVia =
		descriptor.modelVia ?? HARNESS_REGISTRY[opts.harness]?.modelVia;

	try {
		spawnedAt = Date.now();
		await session.open();
		if (session.sessionId) {
			opts.onSession?.({
				sessionId: session.sessionId,
				loadSession: session.loadSession,
			});
		}
		const fresh: FreshSeed | null =
			session.reopen === "fresh" && opts.resume?.fresh
				? await opts.resume.fresh()
				: null;
		// A fresh session has no mode to keep: it takes the run's level, supervised when it named none.
		if (session.reopen === "fresh") keepMode = false;
		// Only a request with the run's token proves the agent loaded our server (OBJ-011).
		const connected =
			opts.gateway && offer?.offered()
				? await opts.gateway.waitConnected(GATEWAY_CONFIRM_MS)
				: false;
		const toolsLine =
			connected && opts.gateway ? `\n\n${opts.gateway.promptLine}` : "";
		// The level's mode; a reopened session already in the stored mode, or that lists none, is sent nothing (#747).
		if (
			!keepMode &&
			!(opts.resume?.sessionId && session.offeredModes.length === 0)
		) {
			const refused = await applyMode(session, {
				label,
				target: askedMode,
				fallback: access.fallbackMode,
			});
			if (refused) {
				yield* leftovers();
				yield adapter.error(refused);
				return;
			}
		}
		if (!keepMode) heldMode = session.currentMode;
		const ranMode = session.currentMode ?? askedMode ?? NO_MODE_KEY;
		const sandbox = await (opts.sandboxCheck ?? checkSandbox)(
			opts.harness,
			[ranMode],
			{ env },
		);
		const ran = ranLevel(
			opts.harness,
			keepMode ? undefined : level,
			session.currentMode ?? askedMode,
		);
		fidelity = {
			...fidelity,
			mode: ranMode,
			fidelity: modeFidelity(sandbox[ranMode]),
			...(keepMode ? {} : { access: level }),
			...(ran ? { ranAccess: ran } : {}),
			...(opts.unattended ? { unattended: true } : {}),
		};
		const noNetwork = fidelity.fidelity === "enforced";
		const modeName =
			session.offeredModes.find((m) => m.id === ranMode)?.name ??
			(ranMode === NO_MODE_KEY ? "no agent mode" : ranMode);
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
				yield* toolsSummary();
				yield adapter.error(
					configId
						? `${label} would not switch to ${chosenModel}; it offered ${offered || "no models"}`
						: `${label} offers no model option, so it cannot take ${chosenModel}`,
				);
				yield* leftovers();
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
				yield* toolsSummary();
				yield adapter.error(
					`${label} would not take ${opts.effort} effort; it offered ${session.effort?.values.join(", ") || "none"}`,
				);
				yield* leftovers();
				return;
			}
			fidelity = { ...fidelity, effort: opts.effort };
		}
		// codex-acp drops the effort after a turn (codex-acp#336), so it is sent again before each later one.
		let turns = 0;
		const turn = async function* (
			parts: PromptPart[],
		): AsyncGenerator<CanonicalEvent, TurnEnd> {
			// A stop during startup found no turn to cancel; prompting now would wait out the prompt timeout.
			if (opts.signal?.aborted) return { stop: "cancelled" };
			// A line queued while the run started is recorded before the turn that may read it (#820).
			yield* recordQueued();
			if (turns++ > 0 && opts.effort && !(await sendEffort()))
				opts.onPolicyWarning?.(`${label} did not keep ${opts.effort} effort`);
			// A short provider wait is sat out here and the message sent again, up to five tries (#1101).
			let attempt = 1;
			let retried: "rate_limited" | "overloaded" | undefined;
			let sent = parts;
			for (;;) {
				// A reopened session's first cumulative cost holds earlier turns: unknown, so no cost.
				const costBefore = lastCost ?? (opts.resume ? null : undefined);
				const end = yield* consume(session.prompt(sent));
				if ("stop" in end) {
					if (attempt > 1 && retried)
						yield adapter.providerRetry(
							retried,
							attempt,
							PROVIDER_RETRY_ATTEMPTS,
							opts.now?.() ?? new Date(),
							"succeeded",
						);
					const usage = turnUsage(end.usage, costBefore, lastCost, lastModel);
					if (usage) yield adapter.turnUsage(usage);
					return end;
				}
				// Claude Code and Codex answer a provider 401 with ACP's auth-required: with a key set, the key was rejected.
				if (!end.failure && keyed && AUTH_REQUIRED.test(end.error))
					end.failure = { mode: "key_rejected" };
				if (!end.failure) return end;
				const failure: RunFailure = { ...end.failure, attempt };
				const next = attempt + 1;
				if (opts.signal?.aborted || !retriesInTurn(failure, next))
					return { ...end, failure };
				const wait = retryDelayMs(failure, next);
				retried = failure.mode as "rate_limited" | "overloaded";
				yield adapter.providerRetry(
					retried,
					next,
					PROVIDER_RETRY_ATTEMPTS,
					new Date((opts.now?.() ?? new Date()).getTime() + wait),
				);
				await (opts.sleep ?? abortableSleep)(wait, opts.signal);
				if (opts.signal?.aborted) return { stop: "cancelled" };
				attempt = next;
				// A command turn is its own only text block; a note before it would break it.
				const command =
					parts[0]?.type === "text" &&
					parts[0].text.trimStart().startsWith("/");
				sent = command
					? parts
					: [{ type: "text", text: PROVIDER_RETRY_NOTE }, ...parts];
			}
		};

		/**
		 * One message as one turn, unless it is a command (#1024): then what PrismaLens adds
		 * (`before`, the addendum, `after`, the `wrap` prompt, the files) goes in a turn just
		 * before, and the command line is its own turn's only text block.
		 */
		const say = async function* (
			line: string,
			context: JobMessageContext | undefined,
			attachments: JobAttachment[] | undefined,
			frame: {
				before?: string[];
				after?: string[];
				wrap?: (message: string) => string;
				/** The record of the command line, yielded just before its own turn goes out. */
				beforeCommand?: () => CanonicalEvent;
			} = {},
		): AsyncGenerator<CanonicalEvent, TurnEnd> {
			const before = frame.before ?? [];
			const after = frame.after ?? [];
			const wrap = frame.wrap ?? ((m: string) => m);
			const command = commandLine(line);
			if (!command)
				return yield* turn(
					promptParts(
						wrap(
							[...before, withAddendum(line, context), ...after].join("\n\n"),
						),
						attachments,
						linkOpts(),
					),
				);
			const extra = [
				...(context?.addendum ? [context.addendum] : []),
				...after,
			];
			if (frame.wrap || before.length || extra.length || attachments?.length) {
				const lead = yield* turn(
					promptParts(
						wrap([...before, COMMAND_LEAD, ...extra].join("\n\n")),
						attachments,
						linkOpts(),
					),
				);
				if (!("stop" in lead) || lead.stop === "cancelled") return lead;
				text = "";
			}
			if (frame.beforeCommand) yield frame.beforeCommand();
			return yield* turn([{ type: "text", text: command }]);
		};

		/** The agent's own compact command as a turn, between two boundary events (#1024). */
		const compactTurn = async function* (
			c: NonNullable<NonNullable<RunInvestigationOptions["resume"]>["compact"]>,
		): AsyncGenerator<CanonicalEvent, TurnEnd> {
			const before = lastUsed;
			// Codex's compact takes no input: focus words would reach it as a malformed command.
			const instructions = HARNESS_REGISTRY[opts.harness].compactTakesFocus
				? c.instructions?.trim()
				: undefined;
			yield adapter.compaction("started", "agent_command", {
				...(before !== undefined ? { before } : {}),
				...(instructions ? { instructions } : {}),
			});
			compacting = true;
			let r: TurnEnd;
			try {
				r = yield* turn([
					{
						type: "text",
						text: `/${c.command}${instructions ? ` ${instructions}` : ""}`,
					},
				]);
			} finally {
				compacting = false;
			}
			const flushed = adapter.flushText();
			if (flushed) yield flushed;
			text = "";
			const ok = "stop" in r && r.stop !== "cancelled";
			yield adapter.compaction(ok ? "completed" : "failed", "agent_command", {
				...(before !== undefined ? { before } : {}),
				...(ok && lastUsed !== undefined && lastUsed !== before
					? { after: lastUsed }
					: {}),
			});
			return r;
		};

		/** Lines sent together: one turn, or each command turn after the lines before it. */
		const sayLines = async function* (
			lines: SteerLine[],
			nowLine: SteerLine | null,
		): AsyncGenerator<CanonicalEvent, TurnEnd> {
			let r: TurnEnd = { stop: "end_turn" };
			let held: SteerLine[] = [];
			// A line is recorded as delivered when its turn is about to go out, never before.
			const record = (line: SteerLine, delivered: boolean) =>
				adapter.operatorMessage(
					line.text,
					line === nowLine ? "now" : "queue",
					delivered,
					undefined,
					refsOf(line.attachments),
					undefined,
					line.id,
					undefined,
					line.context,
				);
			let commandSent = false;
			const flush = async function* (command: SteerLine | null) {
				for (const l of held) yield record(l, true);
				const said = held.map((l) => withAddendum(l.text, l.context));
				const files = [...held, ...(command ? [command] : [])].flatMap(
					(l) => l.attachments ?? [],
				);
				held = [];
				return command
					? yield* say(command.text, command.context, files, {
							before: said,
							beforeCommand: () => {
								commandSent = true;
								return record(command, true);
							},
						})
					: yield* turn(promptParts(said.join("\n\n"), files, linkOpts()));
			};
			for (const [at, line] of lines.entries()) {
				if (!commandLine(line.text)) {
					held.push(line);
					continue;
				}
				commandSent = false;
				r = yield* flush(line);
				if (!("stop" in r) || r.stop === "cancelled") {
					// What the failed turn left unsent, the command included, stays queued for a later resume.
					if (!commandSent) yield record(line, false);
					for (const rest of lines.slice(at + 1)) yield record(rest, false);
					return r;
				}
			}
			return held.length ? yield* flush(null) : r;
		};

		let outcome: TurnEnd;
		// A compaction can fail on a usage limit: the line waits as queued, so a later resume still sends it.
		const lineId =
			opts.resume?.messageId ??
			(opts.resume?.compact && !opts.resume.compact.only
				? randomUUID()
				: undefined);
		if (opts.resume?.compact && !opts.resume.compact.only && lineId)
			yield adapter.messageQueued(
				lineId,
				opts.resume.text,
				refsOf(opts.resume.attachments),
				opts.resume.context,
				opts.resume.delivers,
			);
		const compacted = opts.resume?.compact
			? yield* compactTurn(opts.resume.compact)
			: null;
		if (compacted && ("error" in compacted || opts.resume?.compact?.only)) {
			outcome = compacted;
		} else if (opts.resume) {
			const { text: line, mode, heads, attachments, kind, newer } = opts.resume;
			const handoff = fresh?.text ?? opts.resume.handoff;
			const via = opts.resume.via;
			yield adapter.operatorMessage(
				line,
				mode,
				true,
				heads,
				refsOf(attachments),
				kind ?? "chat",
				lineId,
				fresh && via
					? {
							...via,
							handoff: {
								from: fresh.from,
								carried: fresh.carried,
								omitted: fresh.omitted,
							},
						}
					: via,
				opts.resume.context,
				opts.resume.delivers,
			);
			const seed = (said: string) =>
				kind === "continue"
					? `${investigationPrompt({ modeName, noNetwork, level })}\n\n${handoff}\n\n${said}`
					: buildChatPrompt(opts.context, `${handoff}\n\n${said}`, {
							noNetwork,
							level,
							modeName,
						});
			outcome = yield* say(line, opts.resume.context, attachments, {
				before: opts.resume.afterRestart && !handoff ? [RESTART_NOTE] : [],
				after: newer ? [newerRunNote(newer)] : [],
				...(handoff ? { wrap: seed } : {}),
			});
			// After the turn, so history an agent streams late is counted too.
			if (session.reopen) {
				const reopen = {
					path: session.reopen,
					replayed: session.replayed,
					ms: session.reopenMs,
				};
				wire("in", JSON.stringify({ reopen }));
				opts.onReopen?.(reopen);
			}
		} else if (opts.kind === "chat") {
			const message = opts.brief?.trim() ?? "";
			yield adapter.operatorMessage(
				message,
				"queue",
				true,
				undefined,
				refsOf(opts.attachments),
				undefined,
				undefined,
				undefined,
				opts.messageContext,
			);
			outcome = yield* say(message, opts.messageContext, opts.attachments, {
				wrap: (said) =>
					buildChatPrompt(opts.context, said, {
						noNetwork,
						level,
						modeName,
						tools: toolsLine,
					}),
			});
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
					investigationPrompt({
						modeName,
						noNetwork,
						level,
					}) +
						toolsLine +
						// A service check's prompt already holds the brief (#979).
						(brief && opts.context.mode !== "service-check"
							? `\n\n${brief}`
							: "") +
						(opts.promptSuffix ? `\n\n${opts.promptSuffix}` : ""),
					opts.attachments,
					linkOpts(),
				),
			);
		}

		while ("stop" in outcome && !opts.signal?.aborted) {
			const now = sendNow.shift();
			// Send now carries what was queued before it, in order, in one turn (#673 w33).
			const queued = now ? drain(opts.steer) : [opts.steer?.next() ?? null];
			const lines = [...queued, now ?? null].filter(
				(l): l is SteerLine => l !== null,
			);
			if (lines.length === 0) break;
			text = "";
			outcome = yield* sayLines(lines, now ?? null);
		}
		// Report repair turns still reach the tools, so their calls count until the end (#848).
		yield* leftovers(false);

		if ("error" in outcome) {
			yield* toolsSummary();
			yield opts.signal?.aborted
				? adapter.error(CANCELLED_MESSAGE)
				: adapter.error(...plainStop(outcome.error, outcome.failure, label));
			return;
		}
		if (opts.signal?.aborted || outcome.stop === "cancelled") {
			yield* toolsSummary();
			yield adapter.error(CANCELLED_MESSAGE);
			return;
		}
		// A follow-up is chat only: its answer lives in the stream, never in a report (#747).
		// Continuing a stopped run finishes it as the run it was, report and all (R4.4).
		if (
			opts.kind === "chat" ||
			(opts.resume && opts.resume.kind !== "continue")
		) {
			yield* toolsSummary();
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
			// A stop during the retry is a stop, never a report that did not validate (#673 w34).
			if (
				opts.signal?.aborted ||
				("stop" in retry && retry.stop === "cancelled")
			) {
				yield* toolsSummary();
				yield adapter.error(CANCELLED_MESSAGE);
				return;
			}
			if ("error" in retry) {
				yield* toolsSummary();
				yield adapter.error(...plainStop(retry.error, retry.failure, label));
				return;
			}
			parsed = parseReport(text);
		}
		if (!parsed.ok) {
			yield* toolsSummary();
			yield adapter.error(
				`report did not validate after ${retries === 1 ? "one retry" : "two retries"} (${parsed.reason}: ${parsed.detail})`,
			);
			return;
		}
		if (!sawEvidence) {
			yield* toolsSummary();
			yield adapter.error("investigation produced no evidence: no tool ran");
			return;
		}
		yield* toolsSummary();
		yield adapter.branchDone(mapStopReason(outcome.stop));
		const found = opts.gateway?.findings?.();
		const answered = found ? withFindings(parsed.report, found) : parsed.report;
		const gapped = noNetwork ? withSandboxGap(answered, label) : answered;
		yield adapter.report(
			stampReport(withPreRunCoverage(gapped, opts.context), fidelity),
		);
	} catch (err) {
		yield* leftovers();
		yield adapter.error(err instanceof Error ? err.message : String(err));
	} finally {
		unsubscribe?.();
		unQueued?.();
		unCancel?.();
		opts.signal?.removeEventListener("abort", onAbort);
		await session.close();
	}
}

/**
 * Sets the run's agent mode, or its fallback when the agent does not offer or
 * refuses it (#673 w21 ruling 2026-10-10). Returns why the run cannot start, or null.
 */
async function applyMode(
	session: AcpSession,
	run: { label: string; target: string | null; fallback: string | undefined },
): Promise<string | null> {
	if (!run.target) return null;
	const took =
		(await session.setMode(run.target)) ||
		(!!run.fallback && (await session.setMode(run.fallback)));
	return took
		? null
		: `${run.label} did not offer mode "${run.target}"; run a check in Settings, Agent`;
}

/** A call to the run's own MCP server, by its title, Claude Code's `_meta`, or its input's `server`. */
function namesServer(u: AcpUpdate, server: string): boolean {
	const meta = u._meta as
		| { claudeCode?: { mcpServer?: { name?: unknown } } }
		| undefined;
	const raw = u.rawInput as { server?: unknown } | undefined;
	return (
		(typeof u.title === "string" && u.title.includes(server)) ||
		meta?.claudeCode?.mcpServer?.name === server ||
		raw?.server === server
	);
}

/** An agent sandbox with no network is named under What we could not check (#778). */
function withSandboxGap<R extends { coverage: { notQueried: string[] } }>(
	report: R,
	label: string,
): R {
	const gap = `${label}'s sandbox allows no network`;
	if (report.coverage.notQueried.includes(gap)) return report;
	return {
		...report,
		coverage: {
			...report.coverage,
			notQueried: [...report.coverage.notQueried, gap],
		},
	};
}

const FROM_WORDS = {
	set: "saved in PrismaLens",
	env: "from the environment",
} as const;

/** Where a pre-run source's address and credential came from, for the report and the run log (#848). */
export function sourceOrigin(
	s: Pick<PreRunSource, "from" | "credentialFrom" | "envVar" | "overridesEnv">,
): string {
	const parts: string[] = [FROM_WORDS[s.from]];
	if (s.from === "set" && s.credentialFrom === "env")
		parts.push(`token from ${s.envVar ?? "the environment"}`);
	if (s.credentialFrom === "none") parts.push("no credential");
	if (s.overridesEnv) parts.push(`overrides ${s.overridesEnv}`);
	return parts.join(", ");
}

/**
 * What PrismaLens read before the run, in the report's coverage whatever the agent wrote (#848):
 * found and empty sources under queried; skipped and not-read sources, skipped runbooks and
 * checkouts, and a snapshot that was not saved, copied or there, under what we could not check.
 */
export function withPreRunCoverage<
	R extends { coverage: { queried: string[]; notQueried: string[] } },
>(report: R, context: Pick<InvestigationContext, "preRun">): R {
	const pre = context.preRun;
	if (!pre) return report;
	const queried: string[] = [];
	const notQueried: string[] = [];
	if (pre.state !== "unavailable") {
		for (const s of pre.sources) {
			const who = `${s.label} (${s.kind}, ${sourceOrigin(s)})`;
			if (s.status === "found") queried.push(`${who}: ${s.detail}`);
			else if (s.status === "empty")
				queried.push(`${who}: queried, nothing for the window`);
			else if (s.status === "skipped")
				notQueried.push(`${who}: skipped before the run, ${s.detail}`);
			else notQueried.push(`${who}: not read, ${s.detail}`);
		}
		if (pre.runbooksSkipped)
			notQueried.push(
				`Runbooks: skipped before the run, ${pre.runbooksSkipped}`,
			);
		if (pre.telemetrySkipped)
			notQueried.push(
				`Telemetry: skipped before the run, ${pre.telemetrySkipped}`,
			);
	}
	for (const c of pre.checkoutsSkipped ?? [])
		notQueried.push(
			`Repository ${c.repo}: not checked out before the run, ${c.reason}`,
		);
	if (pre.state === "not-saved")
		notQueried.push(
			"Pre-run snapshot: not saved; a follow-up will not have it",
		);
	if (pre.state !== "unavailable" && pre.copy.state === "failed")
		notQueried.push(
			`Pre-run read copy: not written, ${pre.copy.reason ?? "no working directory took it"}`,
		);
	if (pre.state === "unavailable")
		notQueried.push(`Pre-run snapshot: not available, ${pre.reason}`);
	const add = (have: string[], lines: string[]) =>
		lines.filter((l) => !have.includes(l));
	const q = add(report.coverage.queried, queried);
	const n = add(report.coverage.notQueried, notQueried);
	if (!q.length && !n.length) return report;
	return {
		...report,
		coverage: {
			...report.coverage,
			queried: [...report.coverage.queried, ...q],
			notQueried: [...report.coverage.notQueried, ...n],
		},
	};
}

function drain(steer: SteerPort | undefined): SteerLine[] {
	const left: SteerLine[] = [];
	for (let line = steer?.next(); line; line = steer?.next()) left.push(line);
	return left;
}

/** How a turn ended: its stop reason and reported usage, or its error and the provider stop it was. */
type TurnEnd =
	| { stop: string; usage?: TurnUsage }
	| { error: string; failure?: RunFailure };

const AUTH_REQUIRED = /authentication required|auth_required/i;

/**
 * A provider stop's error says it in plain words, its own words kept as `raw`, so
 * every surface that shows the message shows no code (#1101 category 23 item 4).
 */
export function plainStop(
	message: string,
	failure: RunFailure | undefined,
	agent: string,
): [string, RunFailure?] {
	if (!failure) return [message];
	return [
		`${failureLine(failure, agent)}.`,
		{ ...failure, raw: failure.raw ?? message.slice(0, 500) },
	];
}

/** The agent runs on an API key: one of its key variables (not a base URL or model) is set. */
export function apiKeyIn(
	env: Record<string, string | undefined>,
	keys: readonly string[] | undefined,
): boolean {
	return (keys ?? []).some(
		(k) => /(_API_KEY|_AUTH_TOKEN)$/.test(k) && !!env[k]?.trim(),
	);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const t = setTimeout(done, ms);
		function done() {
			clearTimeout(t);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}

/**
 * One turn's usage: the tokens the prompt response reported, and the cost as the
 * change in the session's cumulative cost; null when the agent reported neither.
 */
export function turnUsage(
	reported: TurnUsage | undefined,
	/** Undefined: a fresh session, from zero; null: unknown. */
	costBefore: RunUsage["cost"] | null,
	costAfter: RunUsage["cost"],
	model: string | undefined,
): TurnUsage | null {
	const spent =
		costAfter &&
		costBefore !== null &&
		(!costBefore || costBefore.currency === costAfter.currency) &&
		costAfter.amount - (costBefore?.amount ?? 0) >= 0
			? {
					amount:
						Math.round((costAfter.amount - (costBefore?.amount ?? 0)) * 1e6) /
						1e6,
					currency: costAfter.currency,
				}
			: undefined;
	if (!reported && (!spent || costAfter === costBefore)) return null;
	return {
		...(reported?.model || model ? { model: reported?.model ?? model } : {}),
		...(reported ?? {}),
		...(spent && costAfter !== costBefore ? { cost: spent } : {}),
	};
}
