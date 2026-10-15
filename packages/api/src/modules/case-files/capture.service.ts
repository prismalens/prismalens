// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The capture queue and runner (spec WU4a, R4): the `captures` table is the
 * scheduled-work table, driven by an in-process tick. The alert listener only
 * inserts a row; kubectl runs later, never inside the listener.
 */
import {
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import type {
	BlockedReason,
	CaptureIdentity,
	CaptureState,
	RetrievalReason,
} from "@prismalens/contracts";
import type { Capture, CaptureArtifact } from "@prismalens/database";
import canonicalize from "canonicalize";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	ALERT_CORRELATED_EVENT,
	type AlertCorrelatedEvent,
} from "../../shared/events/investigation-events.js";
import {
	CAPTURE_DEADLINE_MS,
	COMMAND_BYTE_CAP,
	COMMAND_TIMEOUT_MS,
	MAX_ATTEMPTS,
	MAX_RUNNING,
	MISSED_AFTER_MS,
	QUEUE_CAPACITY,
	RETENTION_SWEEP_MS,
	RETRY_DELAY_MS,
	TICK_MS,
} from "./capture/budget.js";
import {
	type CaptureCommand,
	type CaptureTarget,
	canonicalQuery,
	checklistArgv,
	logsArgv,
	logsCut,
} from "./capture/checklist.js";
import {
	classifyFailure,
	IdentityError,
	resolveIdentity,
} from "./capture/identity.js";
import {
	crashedContainers,
	parsePods,
	sourceRange,
} from "./capture/k8s-parse.js";
import {
	NoKubectlError,
	resolveKubectl,
	runCommand,
} from "./capture/run-command.js";
import { CaseBuilder } from "./case-builder.js";
import { CaseFileSettingsService } from "./case-file-settings.service.js";
import { ArtifactStore, sha256Hex } from "./storage/artifact-store.js";
import {
	artifactEntryBody,
	type ChainTx,
	captureEntryBody,
	ManifestService,
} from "./storage/manifest.js";
import { redact, redactText } from "./storage/redact.js";

/** Emitted with `{ captureId }` after each artifact lands and when a capture ends. */
export const CASE_CAPTURE_UPDATED_EVENT = "case.capture.updated";

export interface CaseCaptureUpdatedEvent {
	captureId: string;
}

export interface EnqueueResult {
	captureId: string;
	state: CaptureState;
	shared: boolean;
}

const COMMAND_CONCURRENCY = 2;
const KUBECTL = "kubectl";

const SEVERITY_PRIORITY: Record<string, number> = {
	critical: 1,
	high: 2,
	medium: 3,
	low: 4,
	info: 4,
};

/** Worst first: the reason a partial capture reports. */
const REASON_RANK: readonly RetrievalReason[] = [
	"error",
	"timeout",
	"byte-cap",
	"page-limit",
];

export function priorityFor(severity: string): number {
	return SEVERITY_PRIORITY[severity] ?? 3;
}

type Rank = { priority: number; caseStartedAt: Date };

/** Lower priority number first, then the earlier case. */
export function ranksAbove(a: Rank, b: Rank): boolean {
	if (a.priority !== b.priority) return a.priority < b.priority;
	return a.caseStartedAt.getTime() < b.caseStartedAt.getTime();
}

export function worstReason(
	reasons: readonly (RetrievalReason | null)[],
): RetrievalReason | null {
	return REASON_RANK.find((r) => reasons.includes(r)) ?? null;
}

const asCommand = (cmd: CaptureCommand): string[] => [KUBECTL, ...cmd.argv];

/** Runs `fn` over `items`, `limit` at a time, starting nothing once `signal` aborts; returns the items never started. */
async function pool<T>(
	items: readonly T[],
	limit: number,
	signal: AbortSignal,
	fn: (item: T) => Promise<void>,
): Promise<T[]> {
	const pending = [...items];
	const worker = async (): Promise<void> => {
		while (pending.length > 0 && !signal.aborted) {
			const next = pending.shift();
			if (next !== undefined) await fn(next);
		}
	};
	// Settle every worker before failing, so no artifact lands after the capture's end entry.
	const settled = await Promise.allSettled(
		Array.from({ length: limit }, worker),
	);
	const failed = settled.find((s) => s.status === "rejected");
	if (failed) throw failed.reason;
	return pending;
}

function parseJson(buf: Buffer): unknown {
	try {
		return JSON.parse(buf.toString("utf8"));
	} catch {
		return null;
	}
}

type HaltReason = "disabled" | "reset";

/** The abort reason, and the error a persist step throws, once the switch is off or a reset has begun. */
class CaptureHaltedError extends Error {
	constructor(readonly reason: HaltReason) {
		super(`capture halted: ${reason}`);
		this.name = "CaptureHaltedError";
	}
}

interface Running {
	cluster: string;
	namespace: string;
	controller: AbortController;
	done: Promise<void>;
}

interface Ending {
	state: CaptureState;
	reason: string | null;
	notRun: string[][];
	lastError?: string;
}

@Injectable()
export class CaptureService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(CaptureService.name);
	private readonly running = new Map<string, Running>();
	private interval: NodeJS.Timeout | undefined;
	private ticking = false;
	private tickAgain = false;
	private tickRun: Promise<void> = Promise.resolve();
	private stopping = false;
	private resetting = false;
	private sweepTimer: NodeJS.Timeout | undefined;
	private sweepRun: Promise<void> | null = null;
	/** Overridable in tests. */
	now: () => Date = () => new Date();

	constructor(
		private readonly prisma: PrismaService,
		private readonly settings: CaseFileSettingsService,
		private readonly store: ArtifactStore,
		private readonly manifest: ManifestService,
		private readonly builder: CaseBuilder,
		private readonly events: EventEmitter2,
	) {
		settings.onDisable(() => this.halt("disabled"));
	}

	async onModuleInit(): Promise<void> {
		// A capture is read-only, so one interrupted by a restart simply runs again (R4).
		await this.prisma.capture.updateMany({
			where: { state: "running" },
			data: { state: "queued" },
		});
		this.interval = setInterval(() => void this.tick(), TICK_MS);
		this.interval.unref();
		void this.sweepRetention();
		this.sweepTimer = setInterval(
			() => void this.sweepRetention(),
			RETENTION_SWEEP_MS,
		);
		this.sweepTimer.unref();
	}

	async onModuleDestroy(): Promise<void> {
		this.stopping = true;
		if (this.interval) clearInterval(this.interval);
		if (this.sweepTimer) clearInterval(this.sweepTimer);
		const all = [...this.running.values()];
		for (const r of all) r.controller.abort();
		await Promise.allSettled([...all.map((r) => r.done), this.sweepRun]);
	}

	/**
	 * Retention for every source, including quiet ones and captures whose binding
	 * was deleted (OBJ-009). It runs whatever the setting says: it only removes.
	 */
	private sweepRetention(): Promise<void> {
		if (this.resetting || this.stopping) return Promise.resolve();
		this.sweepRun ??= this.store
			.sweepAll(this.now())
			.then(
				() => undefined,
				(err: unknown) => {
					this.logger.warn(
						`retention sweep failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				},
			)
			.finally(() => {
				this.sweepRun = null;
			});
		return this.sweepRun;
	}

	/** Runs `work` (a reset) with no capture running or starting and no sweep under way (OBJ-008). */
	async quiesce<T>(work: () => Promise<T>): Promise<T> {
		this.resetting = true;
		try {
			await this.halt("reset");
			await this.sweepRun;
			return await work();
		} finally {
			this.resetting = false;
		}
	}

	/** Aborts every running capture and waits for each to end; a tick under way may still be starting one. */
	private async halt(reason: HaltReason): Promise<void> {
		await this.tickRun;
		const all = [...this.running.values()];
		for (const r of all) r.controller.abort(new CaptureHaltedError(reason));
		await Promise.allSettled(all.map((r) => r.done));
	}

	private async haltedBy(stop: AbortSignal): Promise<HaltReason | null> {
		if (stop.reason instanceof CaptureHaltedError) return stop.reason.reason;
		if (this.resetting) return "reset";
		return (await this.settings.isEnabled()) ? null : "disabled";
	}

	/** Called before every persist step of a running capture. */
	private async mayWrite(stop: AbortSignal): Promise<void> {
		const halted = await this.haltedBy(stop);
		if (halted) throw new CaptureHaltedError(halted);
	}

	@OnEvent(ALERT_CORRELATED_EVENT)
	async handleAlertCorrelated(event: AlertCorrelatedEvent): Promise<void> {
		if (!event.isNewIncident && event.reopened !== true) return;
		try {
			if (!(await this.settings.isEnabled())) return;
			await this.enqueue(event.incidentId, event.alertId);
		} catch (err) {
			this.logger.warn(
				`capture not queued for incident ${event.incidentId}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** The manual route: the listener's work without the opening-alert rule. Null when off or unbound. */
	async captureNow(incidentId: string): Promise<EnqueueResult | null> {
		if (!(await this.settings.isEnabled())) return null;
		return this.enqueue(incidentId, null);
	}

	private async enqueue(
		incidentId: string,
		alertId: string | null,
	): Promise<EnqueueResult | null> {
		const incident = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			include: { service: { include: { binding: true } } },
		});
		const binding = incident?.service?.binding;
		if (!incident || !binding) return null;

		const target: CaptureTarget = {
			kubeContext: binding.kubeContext,
			cluster: binding.cluster,
			namespace: binding.namespace,
		};
		const query = canonicalQuery(target);
		const queryDigest = sha256Hex(canonicalize(query) ?? "");
		const now = this.now();
		const rank: Rank = {
			priority: priorityFor(incident.severity),
			caseStartedAt: incident.createdAt,
		};
		const link = { incidentId, alertId, triggeredAt: now };

		const result = await this.manifest.transaction(async (tx) => {
			const queued = await tx.capture.findFirst({
				where: { queryDigest, state: "queued" },
				orderBy: { createdAt: "asc" },
			});
			if (queued) {
				const linked = await tx.caseCapture.findUnique({
					where: {
						incidentId_captureId: { incidentId, captureId: queued.id },
					},
				});
				if (!linked) {
					await tx.caseCapture.create({
						data: { ...link, captureId: queued.id, shared: true },
					});
				}
				await tx.capture.update({
					where: { id: queued.id },
					data: {
						priority: Math.min(queued.priority, rank.priority),
						caseStartedAt:
							queued.caseStartedAt < rank.caseStartedAt
								? queued.caseStartedAt
								: rank.caseStartedAt,
					},
				});
				return { captureId: queued.id, state: "queued" as const, shared: true };
			}

			let state: CaptureState = "queued";
			const depth = await tx.capture.count({ where: { state: "queued" } });
			if (depth >= QUEUE_CAPACITY) {
				const lowest = await tx.capture.findFirst({
					where: { state: "queued" },
					orderBy: [{ priority: "desc" }, { caseStartedAt: "desc" }],
				});
				if (lowest && ranksAbove(rank, lowest)) {
					const skipped = await tx.capture.update({
						where: { id: lowest.id },
						data: {
							state: "skipped",
							stateReason: "queue-full",
							finishedAt: now,
						},
					});
					await this.appendEnding(tx, skipped, now, target);
				} else {
					state = "skipped";
				}
			}

			const created = await tx.capture.create({
				data: {
					bindingId: binding.id,
					checklistVersion: query.checklistVersion,
					canonicalQuery: JSON.stringify(query),
					queryDigest,
					...target,
					state,
					stateReason: state === "skipped" ? "queue-full" : null,
					finishedAt: state === "skipped" ? now : null,
					priority: rank.priority,
					caseStartedAt: rank.caseStartedAt,
					dueAt: now,
					maxAttempts: MAX_ATTEMPTS,
				},
			});
			await tx.caseCapture.create({
				data: { ...link, captureId: created.id },
			});
			if (state === "skipped")
				await this.appendEnding(tx, created, now, target);
			return { captureId: created.id, state, shared: false };
		});

		setImmediate(() => void this.tick());
		return result;
	}

	/** Starts due captures within the running limits; never awaits a capture's work. */
	async tick(): Promise<void> {
		if (this.ticking) {
			this.tickAgain = true;
			return;
		}
		this.ticking = true;
		this.tickRun = this.runTicks();
		await this.tickRun;
	}

	private async runTicks(): Promise<void> {
		try {
			do {
				this.tickAgain = false;
				await this.startDue();
			} while (this.tickAgain);
		} catch (err) {
			this.logger.warn(
				`capture tick failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			this.ticking = false;
		}
	}

	/** Resolves once every capture running now has ended; for tests and shutdown. */
	async settle(): Promise<void> {
		await Promise.allSettled([
			...[...this.running.values()].map((r) => r.done),
			this.sweepRun,
		]);
	}

	private async startDue(): Promise<void> {
		if (this.stopping || this.resetting || !(await this.settings.isEnabled()))
			return;
		const due = await this.prisma.capture.findMany({
			where: { state: "queued", dueAt: { lte: this.now() } },
			orderBy: [
				{ priority: "asc" },
				{ caseStartedAt: "asc" },
				{ dueAt: "asc" },
			],
		});
		for (const row of due) {
			if (this.running.size >= MAX_RUNNING || this.resetting) return;
			const busy = [...this.running.values()].some(
				(r) => r.cluster === row.cluster && r.namespace === row.namespace,
			);
			if (busy) continue;
			const startedAt = this.now();
			const missed =
				startedAt.getTime() - row.dueAt.getTime() > MISSED_AFTER_MS;
			const { count } = await this.prisma.capture.updateMany({
				where: { id: row.id, state: "queued" },
				data: {
					state: "running",
					startedAt,
					attempts: { increment: 1 },
					...(missed && { missedFrom: row.dueAt, missedTo: startedAt }),
				},
			});
			if (count !== 1) continue;
			const controller = new AbortController();
			const done = this.runCapture(row.id, controller.signal).finally(() => {
				this.running.delete(row.id);
				if (!this.stopping) setImmediate(() => void this.tick());
			});
			this.running.set(row.id, {
				cluster: row.cluster,
				namespace: row.namespace,
				controller,
				done,
			});
		}
	}

	private async runCapture(
		captureId: string,
		stop: AbortSignal,
	): Promise<void> {
		const deadline = new AbortController();
		const onStop = (): void => deadline.abort();
		stop.addEventListener("abort", onStop, { once: true });
		const timer = setTimeout(() => deadline.abort(), CAPTURE_DEADLINE_MS);
		timer.unref();
		try {
			const capture = await this.prisma.capture.findUniqueOrThrow({
				where: { id: captureId },
			});
			let ending: Ending | "retry" | null = null;
			let halted: HaltReason | null = null;
			try {
				ending = await this.runChecklist(capture, deadline.signal, stop);
			} catch (err) {
				if (err instanceof CaptureHaltedError) halted = err.reason;
				else
					ending = {
						state: err instanceof NoKubectlError ? "blocked" : "partial",
						reason: err instanceof NoKubectlError ? "no-kubectl" : "error",
						notRun: [],
						lastError: err instanceof Error ? err.message : String(err),
					};
			}
			// Shutdown leaves the row `running`, so boot queues it again.
			if (this.stopping) return;
			halted ??= await this.haltedBy(stop);
			// A reset deletes this row and its files: anything written now would outlive it.
			if (halted === "disabled") ending = await this.disabledEnding(capture);
			else if (halted === "reset" || ending === null) return;
			if (ending === "retry") {
				await this.prisma.capture.update({
					where: { id: captureId },
					data: {
						state: "queued",
						dueAt: new Date(this.now().getTime() + RETRY_DELAY_MS),
					},
				});
				this.emitUpdated(captureId);
				return;
			}
			await this.end(capture, ending, halted === null);
		} catch (err) {
			this.logger.warn(
				`capture ${captureId} failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			clearTimeout(timer);
			stop.removeEventListener("abort", onStop);
		}
	}

	private async runChecklist(
		capture: Capture,
		signal: AbortSignal,
		stop: AbortSignal,
	): Promise<Ending | "retry"> {
		const target: CaptureTarget = {
			kubeContext: capture.kubeContext,
			cluster: capture.cluster,
			namespace: capture.namespace,
		};
		const checklist = checklistArgv(target);
		const blocked = (reason: BlockedReason, lastError?: string): Ending => ({
			state: "blocked",
			reason,
			notRun: checklist.map(asCommand),
			lastError,
		});

		const bin = resolveKubectl();
		if (!bin) return blocked("no-kubectl");
		let identity: CaptureIdentity;
		try {
			identity = await resolveIdentity(bin, capture.kubeContext, {
				binding: { kubeContext: capture.kubeContext, cluster: capture.cluster },
				signal,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (err instanceof IdentityError) return blocked(err.reason, message);
			return blocked(classifyFailure("", err) ?? "unreachable", message);
		}
		await this.mayWrite(stop);
		await this.prisma.capture.update({
			where: { id: capture.id },
			data: {
				identity: JSON.stringify(identity),
				identityMatches: identity.matchesBinding,
			},
		});
		if (!identity.matchesBinding) {
			return blocked(
				"identity-mismatch",
				`context ${capture.kubeContext} points at ${identity.cluster}`,
			);
		}

		const last = await this.prisma.captureArtifact.findFirst({
			where: { captureId: capture.id },
			orderBy: { seq: "desc" },
			select: { seq: true },
		});
		let seq = last?.seq ?? 0;
		const landed: CaptureArtifact[] = [];
		const stderrs: string[] = [];
		let pods: unknown = null;
		const run = async (cmd: CaptureCommand): Promise<void> => {
			seq += 1;
			const { row, stdout, stderr } = await this.record(
				capture,
				identity,
				target,
				seq,
				cmd,
				bin,
				signal,
				stop,
			);
			landed.push(row);
			stderrs.push(stderr);
			if (cmd.purpose === "pods") pods = parseJson(stdout);
		};

		const listsNotRun = await pool(checklist, COMMAND_CONCURRENCY, signal, run);
		const logs = crashedContainers(parsePods(pods)).flatMap((c) => {
			try {
				return [logsArgv(target, c.pod, c.container)];
			} catch {
				return [];
			}
		});
		const logsNotRun = await pool(logs, COMMAND_CONCURRENCY, signal, run);
		const notRun = [...listsNotRun, ...logsNotRun].map(asCommand);

		const reasons = landed.map(
			(a) => a.retrievalReason as RetrievalReason | null,
		);
		const allErrored =
			landed.length > 0 &&
			notRun.length === 0 &&
			reasons.every((r) => r === "error");
		if (allErrored) {
			// `attempts` already counts this run: startDue increments it.
			if (capture.attempts < capture.maxAttempts) return "retry";
			const classified = stderrs
				.map((s) => classifyFailure(s))
				.find((r) => r !== null);
			if (classified) return { ...blocked(classified), notRun: [] };
		}
		const worst = worstReason(
			notRun.length > 0 ? [...reasons, "timeout"] : reasons,
		);
		return worst === null
			? { state: "complete", reason: null, notRun }
			: { state: "partial", reason: worst, notRun };
	}

	/** One command: run, redact, store, then the row and its manifest entry in one transaction. */
	private async record(
		capture: Capture,
		identity: CaptureIdentity,
		target: CaptureTarget,
		seq: number,
		cmd: CaptureCommand,
		bin: string,
		signal: AbortSignal,
		stop: AbortSignal,
	): Promise<{ row: CaptureArtifact; stdout: Buffer; stderr: string }> {
		const res = await runCommand({
			bin,
			argv: cmd.argv,
			timeoutMs: COMMAND_TIMEOUT_MS,
			byteCap: COMMAND_BYTE_CAP,
			signal,
		});
		let { retrieval, retrievalReason } = res;
		if (
			cmd.purpose === "logs-previous" &&
			retrieval === "complete" &&
			logsCut(res.stdout.length)
		) {
			retrieval = "partial";
			retrievalReason = "byte-cap";
		}
		const redacted = await redact(cmd.purpose, res.stdout);
		const stderr = await redactText(res.stderrTail);
		await this.mayWrite(stop);
		const stored = await this.store.write(
			capture.id,
			seq,
			res.stdout,
			"error" in redacted ? null : redacted.redacted,
		);
		const range = sourceRange(
			cmd.purpose,
			cmd.purpose === "logs-previous"
				? res.stdout.toString("utf8")
				: parseJson(res.stdout),
		);
		const recordedAt = this.now();
		try {
			await this.mayWrite(stop);
		} catch (err) {
			await this.store.discard(capture.id, seq);
			throw err;
		}
		const row = await this.manifest.transaction(async (tx) => {
			const created = await tx.captureArtifact.create({
				data: {
					captureId: capture.id,
					seq,
					purpose: cmd.purpose,
					subject: cmd.subject,
					command: JSON.stringify(asCommand(cmd)),
					retrieval,
					retrievalReason,
					exitCode: res.exitCode,
					// Fails closed: a stderr tail that could not be redacted is not kept.
					stderrTail: "error" in stderr ? null : stderr.text || null,
					startedAt: res.startedAt,
					endedAt: res.endedAt,
					sourceFrom: range.from,
					sourceTo: range.to,
					rawBytes: stored.rawBytes,
					rawSha256: stored.rawSha256,
					redactedBytes: stored.redactedBytes,
					redactedSha256: stored.redactedSha256,
					redactions: JSON.stringify(
						"error" in redacted ? { error: redacted.error } : redacted.counts,
					),
				},
			});
			await tx.capture.update({
				where: { id: capture.id },
				data: { bytesStored: { increment: stored.storedBytes } },
			});
			await this.manifest.append(
				tx,
				artifactEntryBody(created, { target, identity, recordedAt }),
			);
			return created;
		});
		this.emitUpdated(capture.id);
		return { row, stdout: res.stdout, stderr: res.stderrTail };
	}

	/** Turned off mid-run: what landed stays, and each checklist command with no artifact is recorded as not run. */
	private async disabledEnding(capture: Capture): Promise<Ending> {
		const landed = await this.prisma.captureArtifact.findMany({
			where: { captureId: capture.id },
			select: { command: true },
		});
		const ran = new Set(landed.map((a) => a.command));
		const notRun = checklistArgv({
			kubeContext: capture.kubeContext,
			cluster: capture.cluster,
			namespace: capture.namespace,
		})
			.map(asCommand)
			.filter((cmd) => !ran.has(JSON.stringify(cmd)));
		return {
			state: landed.length > 0 ? "partial" : "skipped",
			reason: "disabled",
			notRun,
		};
	}

	/** `derive` false: a halted capture closes its record but builds no case and sweeps nothing. */
	private async end(
		capture: Capture,
		ending: Ending,
		derive = true,
	): Promise<void> {
		const finishedAt = this.now();
		const target: CaptureTarget = {
			kubeContext: capture.kubeContext,
			cluster: capture.cluster,
			namespace: capture.namespace,
		};
		const ended = await this.manifest.transaction(async (tx) => {
			const row = await tx.capture.update({
				where: { id: capture.id },
				data: {
					state: ending.state,
					stateReason: ending.reason,
					finishedAt,
					lastError: ending.lastError ?? null,
				},
			});
			await this.appendEnding(tx, row, finishedAt, target, ending.notRun);
			return row;
		});
		if (derive) await this.buildCases(ended);
		if (derive && ended.bindingId) {
			await this.store
				.sweep(ended.bindingId, finishedAt)
				.catch((err: unknown) => {
					this.logger.warn(
						`retention sweep failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
		}
		this.emitUpdated(capture.id);
	}

	/** The capture-level manifest entry, written once a capture reaches a final state. */
	private async appendEnding(
		tx: ChainTx,
		capture: Capture,
		finishedAt: Date,
		target: CaptureTarget,
		notRun: string[][] = checklistArgv(target).map(asCommand),
	): Promise<void> {
		const entries = await tx.manifestEntry.findMany({
			where: { captureId: capture.id, artifactId: { not: null } },
			orderBy: { seq: "asc" },
			select: { digest: true },
		});
		await this.manifest.append(
			tx,
			captureEntryBody(
				{ ...capture, finishedAt },
				{
					recordedAt: this.now(),
					notRun,
					artifactDigests: entries.map((e) => e.digest),
				},
			),
		);
	}

	private async buildCases(capture: Capture): Promise<void> {
		const [links, artifacts] = await Promise.all([
			this.prisma.caseCapture.findMany({ where: { captureId: capture.id } }),
			this.prisma.captureArtifact.findMany({
				where: { captureId: capture.id },
				orderBy: { seq: "asc" },
			}),
		]);
		for (const link of links) {
			try {
				const alerts = await this.prisma.alert.findMany({
					where: { incidentId: link.incidentId },
				});
				await this.prisma.$transaction((tx) =>
					this.builder.build(tx, {
						incidentId: link.incidentId,
						capture,
						artifacts,
						alerts,
					}),
				);
			} catch (err) {
				this.logger.warn(
					`case build failed for incident ${link.incidentId}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	private emitUpdated(captureId: string): void {
		const payload: CaseCaptureUpdatedEvent = { captureId };
		this.events.emit(CASE_CAPTURE_UPDATED_EVENT, payload);
	}
}
