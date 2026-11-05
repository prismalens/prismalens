// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AskAnswer } from "@prismalens/contracts";
import type { PendingAction } from "@prismalens/database";
import {
	type Failure,
	fail,
	isFailure,
	type ToolOutcome,
} from "@prismalens/integrations/harness";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	ASKS_PORT,
	type AsksPort,
	type ClosedAsk,
} from "../asks/asks.contract.js";
import { isDuplicate, TreeIo } from "./tree-io.service.js";
import { TreeSettings } from "./tree-settings.service.js";

/** What one `act` tool does once allowed; `check` runs at the call and again at approval. */
export interface ActExecutor {
	/** A refusal now: a cap, the setting, the caller's tree. */
	check(callerId: string, args: unknown): Promise<Failure | null>;
	/** Idempotent on `actionId`: a retry finds what the first attempt did. */
	run(callerId: string, args: unknown, actionId: string): Promise<ToolOutcome>;
	/** The card: what the user approves. */
	describe(args: unknown): { title: string; detail: string };
	/** One line for the agent once the action ran. */
	done(args: unknown, value: unknown): string;
}

export interface GateCall {
	callerId: string;
	rootId: string;
	tool: string;
	args: unknown;
	requestId: string;
}

const ENDED = ["done", "failed", "denied", "expired", "cancelled"] as const;
const SETTING_NEXT =
	"Tell the user; they can change Settings → Agent → Agents may start threads.";

const logger = new Logger({ context: "PendingActions" });

/**
 * PrismaLens's own approval for `act` tools (#1024 spec F, decision 1). The call returns at
 * once; the row is durable, so approval, execution and delivery each survive a restart.
 */
@Injectable()
export class PendingActionsService {
	private readonly executors = new Map<string, ActExecutor>();
	private readonly listening = new Map<string, () => void>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly settings: TreeSettings,
		private readonly io: TreeIo,
		@Optional() @Inject(ASKS_PORT) private readonly asks?: AsksPort,
	) {}

	register(tool: string, executor: ActExecutor): void {
		this.executors.set(tool, executor);
	}

	/** Runs an `act` call now, or opens the host's card and answers `pending_approval`. */
	async gate(call: GateCall): Promise<ToolOutcome> {
		const executor = this.executors.get(call.tool);
		if (!executor)
			return fail(
				"internal",
				`${call.tool} is not wired.`,
				"Continue without it.",
			);
		const seen = await this.byRequest(call.callerId, call.requestId);
		if (seen) return this.answerFor(seen);
		const refused = await executor.check(call.callerId, call.args);
		if (refused) return refused;
		const { agentsStartThreads } = await this.settings.get();
		const allowed =
			agentsStartThreads === "allow" || (await this.allowanceOn(call.rootId));
		if (!allowed && !this.asks)
			return fail(
				"disabled",
				"Approvals cannot open in this PrismaLens, so nothing that needs one can run.",
				SETTING_NEXT,
			);
		let row: PendingAction;
		try {
			row = await this.prisma.pendingAction.create({
				data: {
					callerId: call.callerId,
					rootId: call.rootId,
					tool: call.tool,
					args: JSON.stringify(call.args),
					requestId: call.requestId,
					state: allowed ? "approved" : "pending",
					...(allowed ? { decidedAt: new Date() } : {}),
				},
			});
		} catch (e) {
			if (!isDuplicate(e)) throw e;
			const raced = await this.byRequest(call.callerId, call.requestId);
			if (!raced) throw e;
			return this.answerFor(raced);
		}
		if (allowed) {
			const ran = await this.execute(row.id);
			// Answered in the call itself, so nothing is left to deliver.
			await this.prisma.pendingAction.update({
				where: { id: row.id },
				data: { deliveredAt: new Date() },
			});
			return ran;
		}
		const card = executor.describe(call.args);
		const asks = this.asks as AsksPort;
		const askId = await asks.open(call.callerId, {
			kind: "permission",
			requiresHost: true,
			source: { kind: "tool", tool: call.tool, requestId: call.requestId },
			title: card.title,
			detail: card.detail,
			permission: {
				toolKind: "act",
				input: JSON.stringify(call.args).slice(0, 4000),
				options: [
					{ optionId: "allow", name: "Allow once", kind: "allow_once" },
					{
						optionId: "allow_tree",
						name: "Allow for this thread tree",
						kind: "allow_always",
					},
					{ optionId: "deny", name: "Deny", kind: "reject_once" },
				],
			},
		});
		await this.prisma.pendingAction.update({
			where: { id: row.id },
			data: { askId },
		});
		this.listen(askId);
		return this.answerFor({ ...row, askId });
	}

	/** What a call answers for a row it already wrote: a retry gets the same thing. */
	private answerFor(row: PendingAction): ToolOutcome {
		const value = row.result ? JSON.parse(row.result) : null;
		switch (row.state) {
			case "done":
				return { value };
			case "failed":
				return value?.failure
					? (value as Failure)
					: fail("internal", row.error ?? "It failed.", "Continue without it.");
			case "denied":
				return fail(
					"disabled",
					`The user denied ${row.tool}${row.error ? `: ${row.error}` : "."}`,
					"Do not ask again for the same thing; continue without it or ask the user what they want.",
				);
			case "expired":
			case "cancelled":
				return fail(
					"disabled",
					`${row.tool} was ${row.state} before the user answered.`,
					"Continue without it.",
				);
			default:
				return {
					value: {
						status: "pending_approval",
						actionId: row.id,
						...(row.askId ? { askId: row.askId } : {}),
						next: "The user approves this on PrismaLens's card. Do not poll and do not call again: the result arrives as a message at your next pause.",
					},
				};
		}
	}

	private byRequest(callerId: string, requestId: string) {
		return this.prisma.pendingAction.findUnique({
			where: { callerId_requestId: { callerId, requestId } },
		});
	}

	async allowanceOn(rootId: string): Promise<boolean> {
		return !!(await this.prisma.treeAllowance.findUnique({
			where: { rootId },
		}));
	}

	private listen(askId: string): void {
		if (!this.asks || this.listening.has(askId)) return;
		const off = this.asks.onClosed(askId, (closed) => {
			this.listening.get(askId)?.();
			this.listening.delete(askId);
			void this.closed(closed).catch((e) =>
				logger.warn(`Could not act on a closed ask: ${(e as Error).message}`),
			);
		});
		this.listening.set(askId, off);
	}

	/** The host answered, or the ask lapsed: decide the row, then run it. */
	async closed(closed: ClosedAsk): Promise<void> {
		const row = await this.prisma.pendingAction.findFirst({
			where: { askId: closed.ask.askId },
		});
		if (row?.state !== "pending") return;
		const answer: AskAnswer | undefined = closed.answer;
		const approved =
			answer?.kind === "permission" && answer.decision === "approve";
		const next = approved
			? "approved"
			: answer?.kind === "permission"
				? "denied"
				: "expired";
		const { count } = await this.prisma.pendingAction.updateMany({
			where: { id: row.id, state: "pending" },
			data: {
				state: next,
				decidedAt: new Date(),
				...(next === "denied" && answer?.kind === "permission" && answer.reason
					? { error: answer.reason }
					: {}),
			},
		});
		if (!count) return;
		if (approved && answer?.kind === "permission" && answer.scope === "tree")
			await this.prisma.treeAllowance.upsert({
				where: { rootId: row.rootId },
				create: { rootId: row.rootId, grantedBy: "host" },
				update: {},
			});
		if (approved) await this.execute(row.id);
		await this.deliverOutcomes();
	}

	/**
	 * Runs an approved row once: `check` again against current state, then the executor,
	 * which is idempotent on the row id, so a crash between the two never doubles it.
	 */
	async execute(id: string): Promise<ToolOutcome> {
		const row = await this.prisma.pendingAction.findUnique({ where: { id } });
		if (!row)
			return fail("not_found", "No such action.", "Continue without it.");
		if (row.state !== "approved" && row.state !== "executing")
			return this.answerFor(row);
		await this.prisma.pendingAction.updateMany({
			where: { id, state: "approved" },
			data: { state: "executing" },
		});
		const executor = this.executors.get(row.tool);
		const args: unknown = JSON.parse(row.args);
		let outcome: ToolOutcome;
		if (!executor)
			outcome = fail(
				"internal",
				`${row.tool} is not wired.`,
				"Continue without it.",
			);
		else {
			try {
				outcome =
					(await executor.check(row.callerId, args)) ??
					(await executor.run(row.callerId, args, row.id));
			} catch (e) {
				logger.warn(`${row.tool} failed: ${(e as Error).message}`);
				outcome = fail(
					"internal",
					`${row.tool} failed inside PrismaLens.`,
					"Do not retry this call; continue without it.",
				);
			}
		}
		await this.prisma.pendingAction.updateMany({
			where: { id, state: "executing" },
			data: isFailure(outcome)
				? {
						state: "failed",
						result: JSON.stringify(outcome),
						error: outcome.failure.message,
						executedAt: new Date(),
					}
				: {
						state: "done",
						result: JSON.stringify(outcome.value),
						executedAt: new Date(),
					},
		});
		return outcome;
	}

	/** Cancels a cancelled caller's open actions; a late answer then finds nothing to do. */
	async cancelFor(callerId: string): Promise<void> {
		const open = await this.prisma.pendingAction.findMany({
			where: { callerId, state: "pending" },
		});
		for (const row of open) {
			await this.prisma.pendingAction.updateMany({
				where: { id: row.id, state: "pending" },
				data: {
					state: "cancelled",
					decidedAt: new Date(),
					deliveredAt: new Date(),
				},
			});
			if (row.askId) {
				this.listening.get(row.askId)?.();
				this.listening.delete(row.askId);
				// `close` joins the port additively (lane A); until then a late answer is ignored.
				const port = this.asks as
					| (AsksPort & { close?: (id: string, o: string) => Promise<unknown> })
					| undefined;
				await port?.close?.(row.askId, "stopped")?.catch?.(() => {});
			}
		}
	}

	/** Tells each caller how its action ended, reopening an ended caller when it must. */
	async deliverOutcomes(): Promise<void> {
		const rows = await this.prisma.pendingAction.findMany({
			where: { state: { in: [...ENDED] }, deliveredAt: null },
			orderBy: { createdAt: "asc" },
			take: 50,
		});
		for (const row of rows) {
			const text = this.outcomeText(row);
			const got = await this.io.deliver(row.callerId, text, { reopen: true });
			if (got.state === "later") continue;
			await this.prisma.pendingAction.update({
				where: { id: row.id },
				data: { deliveredAt: new Date() },
			});
		}
	}

	private outcomeText(row: PendingAction): string {
		const head = `[PrismaLens] Your ${row.tool} call (requestId "${row.requestId}")`;
		const value = row.result ? JSON.parse(row.result) : null;
		if (row.state === "done") {
			const executor = this.executors.get(row.tool);
			return `${head} was approved: ${executor ? executor.done(JSON.parse(row.args), value) : "done."}`;
		}
		if (row.state === "denied")
			return `${head} was denied by the user${row.error ? `: ${row.error}` : "."} Do not ask again for the same thing.`;
		if (row.state === "failed") {
			const f = (value as Failure | null)?.failure;
			return `${head} was approved but did not run: ${f?.message ?? row.error ?? "it failed"}${f?.next ? ` Next: ${f.next}` : ""}`;
		}
		return `${head} was ${row.state} before the user answered.`;
	}

	/** At boot: approved rows run, and asks closed while PrismaLens was down are read again. */
	async resume(): Promise<void> {
		const rows = await this.prisma.pendingAction.findMany({
			where: { state: { in: ["approved", "executing", "pending"] } },
		});
		for (const row of rows) {
			if (row.state !== "pending") {
				await this.execute(row.id);
				continue;
			}
			if (!row.askId || !this.asks) continue;
			const got = await this.asks.get(row.askId);
			if (!got) {
				await this.prisma.pendingAction.updateMany({
					where: { id: row.id, state: "pending" },
					data: { state: "expired", decidedAt: new Date() },
				});
				continue;
			}
			if (got.closed) await this.closed(got.closed);
			else this.listen(row.askId);
		}
		await this.deliverOutcomes();
	}

	stop(): void {
		for (const off of this.listening.values()) off();
		this.listening.clear();
	}
}
