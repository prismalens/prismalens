// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Posts a finished investigation to Slack through an incoming webhook (#606,
 * ADR 0008 §1). Off until a webhook is set. A failed post never fails the run:
 * it lands on the incident timeline so the page says why nothing arrived.
 */
import { Injectable, Logger } from "@nestjs/common";
import type {
	InvestigationReport,
	ReportDeliverySettings,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { CredentialsService } from "../integrations/crypto/credentials.service.js";
import { TimelineService } from "../timeline/timeline.service.js";

const SETTING_KEY = "REPORT_DELIVERY";
const POST_TIMEOUT_MS = 10_000;
const SLACK_TEXT_LIMIT = 3_000;
/** How long a delivered run is remembered, so one run posts once. */
const DEDUP_TTL_MS = 60 * 60_000;

interface StoredDelivery {
	slackWebhookUrlEnc?: string;
}

export interface DeliverableRun {
	status: string;
	incident: { id: string; number: number; title: string };
	report: InvestigationReport | null;
	error: string | null;
}

/**
 * Slack's three control characters. Report text is model output over alert
 * text, so `<!channel>` or a `<url|label>` link in it must not become a live
 * mention or a disguised link in the team's channel.
 */
export function escapeSlack(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Slack mrkdwn for one finished run: title, outcome, summary and root cause. */
export function slackMessage(run: DeliverableRun): string {
	const e = escapeSlack;
	const head = `*INC-${run.incident.number}: ${e(run.incident.title)}*`;
	if (run.status !== "completed" || !run.report) {
		const why = run.error ? `: ${e(run.error)}` : ".";
		return `${head}\nInvestigation ${run.status}${why}`.slice(
			0,
			SLACK_TEXT_LIMIT,
		);
	}
	const lines = [head, `*Summary:* ${e(run.report.summary)}`];
	if (run.report.rootCause)
		lines.push(`*Root cause:* ${e(run.report.rootCause)}`);
	const top = run.report.nextSteps[0];
	if (top) lines.push(`*Next step:* ${e(top.title)}`);
	return lines.join("\n").slice(0, SLACK_TEXT_LIMIT);
}

@Injectable()
export class ReportDeliveryService {
	private readonly logger = new Logger(ReportDeliveryService.name);
	/**
	 * Runs already delivered (a failed run reaches both run ports), with when.
	 * Pruned by age so a long-lived install does not keep one entry per run.
	 */
	private readonly delivered = new Map<string, number>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly credentials: CredentialsService,
		private readonly timeline: TimelineService,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	private async read(): Promise<StoredDelivery> {
		const row = await this.prisma.setting.findUnique({
			where: { key: SETTING_KEY },
		});
		return (row && (safeParseJsonObject(row.value) as StoredDelivery)) ?? {};
	}

	async getSettings(): Promise<ReportDeliverySettings> {
		return { slackConfigured: Boolean((await this.read()).slackWebhookUrlEnc) };
	}

	async setSlackWebhook(url: string | null): Promise<ReportDeliverySettings> {
		const value: StoredDelivery = url
			? { slackWebhookUrlEnc: this.credentials.encryptToBase64(url) }
			: {};
		await this.prisma.setting.upsert({
			where: { key: SETTING_KEY },
			update: { value: JSON.stringify(value), type: "encrypted" },
			create: {
				key: SETTING_KEY,
				value: JSON.stringify(value),
				type: "encrypted",
				category: "notifications",
			},
		});
		return this.getSettings();
	}

	/** Deliver one terminal run, once. Never throws. */
	async deliver(investigationId: string): Promise<void> {
		const now = Date.now();
		for (const [id, at] of this.delivered) {
			if (now - at > DEDUP_TTL_MS) this.delivered.delete(id);
		}
		if (this.delivered.has(investigationId)) return;
		this.delivered.set(investigationId, now);
		try {
			const { slackWebhookUrlEnc } = await this.read();
			if (!slackWebhookUrlEnc) return;
			const investigation = await this.prisma.investigation.findUnique({
				where: { id: investigationId },
				include: {
					incident: { select: { id: true, number: true, title: true } },
				},
			});
			if (!investigation?.incident) return;
			const run: DeliverableRun = {
				status: investigation.status,
				incident: investigation.incident,
				report: safeParseJsonObject(
					investigation.report,
				) as InvestigationReport | null,
				error: investigation.error,
			};
			const url =
				this.credentials.decryptFromBase64<string>(slackWebhookUrlEnc);
			const failure = await this.post(url, slackMessage(run));
			if (failure) {
				await this.timeline.create({
					incidentId: run.incident.id,
					type: TimelineEntryType.custom,
					title: "Slack delivery failed",
					description: failure,
					source: TimelineSource.system,
					metadata: { investigationId },
				});
			}
		} catch (e) {
			this.logger.warn(`Report delivery skipped: ${String(e)}`);
		}
	}

	/** null on success, else a one-line reason. */
	private async post(url: string, text: string): Promise<string | null> {
		try {
			const res = await this.fetchImpl(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
				signal: AbortSignal.timeout(POST_TIMEOUT_MS),
			});
			if (res.ok) return null;
			const body = (await res.text().catch(() => "")).slice(0, 200);
			return `Slack answered ${res.status}${body ? `: ${body}` : ""}`;
		} catch (e) {
			return `Slack unreachable: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
}
