// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SAFE_ENV_ALLOWLIST } from "@prismalens/agent-host";
import {
	type AskQuestion,
	type PendingAsk,
	QUESTION_ASK_TIMEOUT_MS,
	questionTimeoutFrom,
	SECRET_ENV_NAME,
} from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	DispatchService,
	QUESTION_TIMEOUT_SETTING,
} from "../../infrastructure/dispatch/dispatch.service.js";
import {
	AskConflict,
	AskForbidden,
	type ClosedAsk,
} from "../asks/asks.contract.js";
import { AsksService } from "../asks/asks.service.js";
import { CredentialsService } from "../integrations/crypto/credentials.service.js";
import { InvestigationsService } from "./investigations.service.js";

const logger = new Logger({ context: "ToolAsks" });

export const ASK_USER = "ask_user";
export const SECRET_REQUEST = "secret_request";
const TERMINAL: ReadonlySet<string> = new Set([
	"completed",
	"failed",
	"cancelled",
]);
/** What the agent's env must keep: the launch floor's names, PrismaLens's own and git's. */
const REFUSED_PREFIXES = ["PRISMALENS_", "GIT_", "GH_"];
const REFUSED_NAMES: ReadonlySet<string> = new Set<string>(SAFE_ENV_ALLOWLIST);

/** Why `name` cannot carry a requested secret; null when it can. */
export function secretNameRefusal(name: string): string | null {
	if (!SECRET_ENV_NAME.test(name))
		return "Name it like an environment variable: capitals, digits and _, starting with a letter, at most 64 characters.";
	if (
		REFUSED_NAMES.has(name) ||
		REFUSED_PREFIXES.some((p) => name.startsWith(p))
	)
		return `${name} is one PrismaLens sets itself; pick another name.`;
	return null;
}

/** What the agent hears when its question closes. */
export function answerText(closed: ClosedAsk): string {
	const { ask } = closed;
	if (closed.outcome !== "answered" || closed.answer?.kind !== "question")
		return `Your question "${ask.title}" (ask_user) was not answered: ${closed.outcome}. Decide without it, or ask again later.`;
	const lines = (ask.questions ?? []).map((q) => {
		const a =
			closed.answer?.kind === "question"
				? closed.answer.answers[q.id]
				: undefined;
		const picked = (a?.options ?? []).map(
			(id) => q.options.find((o) => o.id === id)?.label ?? id,
		);
		const other = a?.other ? [`Other: ${a.other}`] : [];
		const said = [...picked, ...other].join("; ") || "no answer";
		return `- ${q.prompt} → ${said}`;
	});
	return `The user answered your question (ask_user):\n${lines.join("\n")}`;
}

/**
 * The asks PrismaLens's own `ask_user` and `secret_request` tools open (#1024 spec B).
 * Each is a surface A tool ask; its answer reaches the agent as a message, and a
 * secret's value only as an environment variable when the session next opens.
 */
@Injectable()
export class ToolAsksService implements OnModuleInit {
	constructor(
		private readonly prisma: PrismaService,
		private readonly asks: AsksService,
		private readonly dispatch: DispatchService,
		private readonly investigations: InvestigationsService,
		private readonly credentials: CredentialsService,
	) {}

	/** A restart dropped the in-process handlers: an `ask_user` still open hears its answer again. */
	async onModuleInit(): Promise<void> {
		const open = await this.prisma.toolAsk
			.findMany({
				where: { status: "open" },
				select: { askId: true, ask: true },
			})
			.catch(() => []);
		for (const row of open) {
			const ask = JSON.parse(row.ask) as PendingAsk;
			if (ask.source.kind === "tool" && ask.source.tool === ASK_USER)
				this.deliverOnClose(row.askId);
		}
	}

	/** Opens a question ask; it returns at once and the answer comes as a message. */
	async question(
		runId: string,
		questions: AskQuestion[],
	): Promise<{ askId: string } | { error: string }> {
		const run = await this.investigations.findById(runId);
		if (!run) return { error: "This run is gone." };
		const timeout = await this.questionTimeout();
		const askId = randomUUID();
		const first = questions[0]?.prompt ?? "A question";
		await this.asks.open(runId, {
			askId,
			kind: "question",
			requiresHost: false,
			source: { kind: "tool", tool: ASK_USER, requestId: askId },
			title: first.slice(0, 500),
			expiresAt: new Date(Date.now() + timeout).toISOString(),
			questions,
		});
		this.deliverOnClose(askId);
		return { askId };
	}

	/** Opens a secret ask: a name and a reason, never a value field. */
	async secret(
		runId: string,
		input: { name: string; reason: string },
	): Promise<{ requestId: string; name: string } | { error: string }> {
		const refused = secretNameRefusal(input.name);
		if (refused) return { error: refused };
		const run = await this.investigations.findById(runId);
		if (!run) return { error: "This run is gone." };
		const timeout = await this.questionTimeout();
		const requestId = randomUUID();
		await this.prisma.secretRequested.create({
			data: { investigationId: runId, requestId, name: input.name },
		});
		await this.asks.open(runId, {
			askId: requestId,
			kind: "secret",
			requiresHost: true,
			source: { kind: "tool", tool: SECRET_REQUEST, requestId },
			title: input.name,
			detail: input.reason,
			// A request nobody answers closes like a question does, never waiting for good.
			expiresAt: new Date(Date.now() + timeout).toISOString(),
		});
		return { requestId, name: input.name };
	}

	/**
	 * The user's secret, write-only (#1024 spec B): encrypted at rest, the ask closes
	 * `answered`, and nothing that answers, logs or pushes carries the value.
	 */
	async answerSecret(
		threadId: string,
		requestId: string,
		value: string,
		host: boolean,
	): Promise<void> {
		if (!host)
			throw new AskForbidden(
				"Only this machine's own session can answer this.",
			);
		const row = await this.prisma.secretRequested.findUnique({
			where: { requestId },
		});
		if (!row || row.investigationId !== threadId)
			throw new AskConflict("No such request on this thread.");
		const ask = await this.asks.get(requestId);
		if (!ask || ask.closed)
			throw new AskConflict("This request is no longer waiting.");
		const won = await this.prisma.$transaction(async (tx) => {
			const set = await tx.secretRequested.updateMany({
				where: { requestId, answeredAt: null },
				data: {
					valueEnc: this.credentials.encryptToBase64(value),
					answeredAt: new Date(),
				},
			});
			if (set.count !== 1) return false;
			// The newest value for a name is the one the run gets.
			await tx.secretRequested.deleteMany({
				where: {
					investigationId: threadId,
					name: row.name,
					requestId: { not: requestId },
				},
			});
			return true;
		});
		if (!won) throw new AskConflict("This request is no longer waiting.");
		await this.asks.close(requestId, "answered");
		// The value is kept: a delivery that fails leaves the user's answer standing.
		await this.deliver(
			threadId,
			`The user gave the secret you asked for. It is in the environment variable ${row.name} from the next time this session opens; refer to it by that name and never print its value.`,
		).catch((e) =>
			logger.warn(`Could not tell the agent its secret is set: ${String(e)}`),
		);
	}

	/** Settings → Agent → "Questions from agents wait for", else the default. */
	private async questionTimeout(): Promise<number> {
		const set = await this.prisma.setting
			.findUnique({ where: { key: QUESTION_TIMEOUT_SETTING } })
			.then((row) => questionTimeoutFrom(row?.value))
			.catch(() => undefined);
		return set ?? QUESTION_ASK_TIMEOUT_MS;
	}

	private deliverOnClose(askId: string): void {
		this.asks.onClosed(askId, (closed) => {
			const text = answerText(closed);
			// A question nobody answered does not start the agent again; one that was answered does.
			void this.deliver(
				closed.ask.threadId,
				text,
				closed.outcome === "answered",
			).catch((e) =>
				logger.warn(`Could not hand the agent its answer: ${String(e)}`),
			);
		});
	}

	/** Queue `text` to a live run, or continue a finished one with it. */
	private async deliver(
		threadId: string,
		text: string,
		resume = true,
	): Promise<void> {
		const run = await this.investigations.findById(threadId);
		if (!run) return;
		if (!TERMINAL.has(run.status)) {
			const state = this.dispatch.sendMessage(
				threadId,
				text,
				"queue",
				[],
				undefined,
				randomUUID(),
			);
			if (state && state !== "conflict") return;
			// The run ended between the read and the send: continue it instead.
		}
		if (!resume) return;
		await this.dispatch.resumeInvestigation(threadId, text, "queue", "chat");
	}
}
