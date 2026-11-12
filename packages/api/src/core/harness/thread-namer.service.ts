// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings → Models → Thread titles (#1101 - Wave 2: thread UX hill climb, round 2):
 * a small model on the thread's own agent replaces the instant title once. Never awaited
 * by a run, and any failure keeps the instant title.
 */
import { Injectable, Logger } from "@nestjs/common";
import { HARNESS_IDS, type HarnessId } from "@prismalens/config/harness";
import {
	smallestModel,
	THREAD_TITLE_LENGTH,
	type ThreadTitleSettings,
} from "@prismalens/contracts/schemas";
import { nameThread } from "@prismalens/engine";
import {
	generatedTitle,
	setGeneratedTitle,
	titlePrompt,
} from "../../modules/threads/thread-titles.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { HarnessService } from "./harness.service.js";
import { HarnessModelsService } from "./harness-models.service.js";

export type NameOutcome =
	| "named"
	| "off"
	| "no-model"
	| "kept"
	| "empty"
	| "failed";

@Injectable()
export class ThreadNamerService {
	private readonly logger = new Logger(ThreadNamerService.name);
	/** Threads with a naming in flight, so a second request for one waits for none. */
	private readonly inFlight = new Set<string>();
	/** The engine call, a field so a test can stand in for the agent. */
	name: typeof nameThread = nameThread;

	constructor(
		private readonly prisma: PrismaService,
		private readonly harness: HarnessService,
		private readonly models: HarnessModelsService,
	) {}

	/** The model a title on `agent` would use; null when titles keep the instant one. */
	modelFor(agent: HarnessId, s: ThreadTitleSettings): string | null {
		if (s.enabled === false) return null;
		const entries = this.models.modelsFor(agent)?.entries ?? [];
		return s.models?.[agent] ?? smallestModel(entries);
	}

	/**
	 * The thread menu's "Name it again", from what started the thread: a chat's first
	 * message event, else the job's brief or alert, else the incident title.
	 */
	async regenerate(runId: string): Promise<NameOutcome> {
		const row = await this.prisma.investigation.findUnique({
			where: { id: runId },
			select: {
				title: true,
				harness: true,
				incident: { select: { title: true } },
			},
		});
		if (!row?.harness || !HARNESS_IDS.includes(row.harness as HarnessId))
			return "no-model";
		const first =
			(await this.firstMessage(runId)) ??
			(await this.jobText(runId)) ??
			row.incident?.title ??
			row.title ??
			"";
		if (!first.trim()) return "empty";
		return this.nameOnce(runId, row.harness as HarnessId, first, true);
	}

	private async firstMessage(runId: string): Promise<string | null> {
		const events = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: runId,
				event: { contains: '"operator_message"' },
			},
			orderBy: { ordinal: "asc" },
			take: 1,
			select: { event: true },
		});
		return textOf(events[0]?.event, (raw) =>
			typeof raw.text === "string" ? raw.text : null,
		);
	}

	/** A follow-up's job replaces the first one, so only a payload without `resume` counts. */
	private async jobText(runId: string): Promise<string | null> {
		const job = await this.prisma.job.findUnique({
			where: { investigationId: runId },
			select: { payload: true },
		});
		return textOf(job?.payload, (raw) => {
			if (raw.resume) return null;
			const alert = Array.isArray(raw.alerts)
				? (raw.alerts[0] as
						| { alertname?: unknown; annotations?: { summary?: unknown } }
						| undefined)
				: undefined;
			const summary = alert?.annotations?.summary;
			const candidates = [
				(raw.chat as { text?: unknown } | undefined)?.text,
				raw.brief,
				typeof summary === "string" ? summary : alert?.alertname,
			];
			return candidates.find((c): c is string => typeof c === "string") ?? null;
		});
	}

	/**
	 * Names thread `runId` from its first message. `force` is the user's "Name it again":
	 * it runs on a renamed thread and with titles off, but never without a model.
	 */
	async nameOnce(
		runId: string,
		agent: HarnessId,
		first: string,
		force = false,
	): Promise<NameOutcome> {
		if (this.inFlight.has(runId)) return "kept";
		this.inFlight.add(runId);
		try {
			const settings = (await this.harness.getSettings()).threadTitles ?? {};
			if (!force && settings.enabled === false) return "off";
			const model = this.modelFor(agent, { ...settings, enabled: true });
			if (!model) return "no-model";
			const row = await this.prisma.investigation.findUnique({
				where: { id: runId },
				select: {
					title: true,
					titleSetBy: true,
					incident: { select: { title: true } },
				},
			});
			if (!row || (!force && row.titleSetBy)) return "kept";
			const maxLength = settings.maxLength ?? THREAD_TITLE_LENGTH.default;
			const runtime = await this.harness.runtimeFor(agent);
			const answer = await this.name(agent, {
				prompt: titlePrompt({
					first,
					alertTitle: row.incident?.title ?? null,
					maxLength,
					style: settings.style ?? "sentence",
				}),
				model,
				env: runtime.env,
				...(runtime.policy ? { policy: runtime.policy } : {}),
				...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
				...(runtime.launchArgs ? { launchArgs: runtime.launchArgs } : {}),
			});
			const title = generatedTitle(answer.text, maxLength);
			if (!title) return "empty";
			const written = await setGeneratedTitle(this.prisma, runId, title, {
				title: row.title,
				force,
			});
			return written ? "named" : "kept";
		} catch (e) {
			this.logger.debug(
				`Thread ${runId} keeps its first title: ${e instanceof Error ? e.message : String(e)}`,
			);
			return "failed";
		} finally {
			this.inFlight.delete(runId);
		}
	}
}

/** A stored JSON row's text, or null when it is absent, unreadable or blank. */
function textOf(
	json: string | undefined,
	pick: (raw: Record<string, unknown>) => string | null,
): string | null {
	if (!json) return null;
	try {
		const text = pick(JSON.parse(json) as Record<string, unknown>);
		return text?.trim() ? text : null;
	} catch {
		return null;
	}
}
