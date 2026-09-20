// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Posts a finished investigation report as a comment on a GitHub issue or PR (#606).
 * Given a target URL at post time, picks an ACTIVE GitHub connection, formats
 * the Markdown report, and posts to GitHub's issue comments API.
 */
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	GITHUB_ISSUE_OR_PR_URL,
	InvestigationReportSchema,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { reportToMarkdown } from "../investigations/report-markdown.js";
import { TimelineService } from "../timeline/timeline.service.js";

export const GITHUB_COMMENT_CHAR_LIMIT = 60_000;
export const TRUNCATION_MARKER = "\n\n… [truncated]";

export function formatGitHubCommentBody(opts: {
	incidentNumber: number;
	markdown: string;
	limit?: number;
}): string {
	const limit = opts.limit ?? GITHUB_COMMENT_CHAR_LIMIT;
	const prefix = `_Posted by PrismaLens from INC-${opts.incidentNumber}_\n\n`;
	let body = `${prefix}${opts.markdown}`;
	if (body.length > limit) {
		const maxLen = limit - TRUNCATION_MARKER.length;
		body = body.slice(0, maxLen) + TRUNCATION_MARKER;
	}
	return body;
}

@Injectable()
export class GitHubCommentService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly integrations: IntegrationsService,
		private readonly timeline: TimelineService,
		private readonly telemetry: TelemetryService,
	) {}

	async post(
		investigationId: string,
		target: string,
	): Promise<{ commentUrl: string }> {
		// 1. Parse target with regex → owner, repo, number
		const match = target.trim().match(GITHUB_ISSUE_OR_PR_URL);
		if (!match) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Must be a https://github.com/<owner>/<repo>/issues/<n> or /pull/<n> URL",
			});
		}
		const [, owner, repo, , number] = match;

		// 2. Load investigation with incident; validate report
		const investigation = await this.prisma.investigation.findUnique({
			where: { id: investigationId },
			include: {
				incident: { select: { id: true, number: true, title: true } },
			},
		});
		const parsed = InvestigationReportSchema.safeParse(
			safeParseJsonObject(investigation?.report),
		);
		const report = parsed.success ? parsed.data : null;
		if (!investigation?.incident || !report) {
			throw new ORPCError("NOT_FOUND", {
				message: `Investigation ${investigationId} has no report`,
			});
		}

		// 3. Pick connection
		const connections = await this.prisma.connection.findMany({
			where: {
				status: "ACTIVE",
				integration: {
					templateId: { in: ["github-app", "github-token"] },
				},
			},
			include: { repositories: { select: { fullName: true } } },
			orderBy: { createdAt: "asc" },
		});

		if (connections.length === 0) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "No GitHub connection is configured (Settings → Integrations)",
			});
		}

		const targetSlug = `${owner}/${repo}`.toLowerCase();
		const connection =
			connections.find((c) =>
				c.repositories.some((r) => r.fullName.toLowerCase() === targetSlug),
			) ?? connections[0];

		// 4. Format body capped at 60 000 chars
		const rawMarkdown = reportToMarkdown({
			incident: investigation.incident,
			report,
			completedAt: investigation.completedAt,
		});
		const body = formatGitHubCommentBody({
			incidentNumber: investigation.incident.number,
			markdown: rawMarkdown,
			limit: GITHUB_COMMENT_CHAR_LIMIT,
		});

		// 5. Send comment request via createRequestFn
		let res: Response;
		try {
			const requestFn = this.integrations.createRequestFn(connection.id);
			res = await requestFn(
				"POST",
				`/repos/${owner}/${repo}/issues/${number}/comments`,
				{
					body: JSON.stringify({ body }),
					headers: {
						"content-type": "application/json",
						accept: "application/vnd.github+json",
					},
				},
			);
		} catch (err) {
			await this.telemetry.capture("report_exported", { target: "github" });
			const description = `GitHub unreachable: ${err instanceof Error ? err.message : String(err)}`;
			await this.timeline.create({
				incidentId: investigation.incident.id,
				type: TimelineEntryType.custom,
				title: "GitHub post failed",
				description,
				source: TimelineSource.system,
				metadata: { investigationId, target },
			});
			throw new ORPCError("BAD_GATEWAY", { message: description });
		}

		await this.telemetry.capture("report_exported", { target: "github" });

		// 6. Handle failure responses
		if (!res.ok) {
			let description = `GitHub answered ${res.status} for ${target}`;
			if (res.status === 403) {
				description +=
					" — a GitHub App needs Issues: write; a token needs repo scope";
			}
			await this.timeline.create({
				incidentId: investigation.incident.id,
				type: TimelineEntryType.custom,
				title: "GitHub post failed",
				description,
				source: TimelineSource.system,
				metadata: { investigationId, target },
			});
			throw new ORPCError("BAD_GATEWAY", { message: description });
		}

		// 7. Parse response, record timeline, return commentUrl
		const data = (await res.json().catch(() => ({}))) as {
			html_url?: string;
		};
		const commentUrl = data.html_url ?? "";

		await this.timeline.create({
			incidentId: investigation.incident.id,
			type: TimelineEntryType.custom,
			title: "Report posted to GitHub",
			description: commentUrl,
			source: TimelineSource.system,
			metadata: { investigationId, target, commentUrl },
		});

		return { commentUrl };
	}
}
