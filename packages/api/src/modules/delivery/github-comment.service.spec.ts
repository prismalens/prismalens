// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import type { InvestigationReport } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { telemetryStub } from "../../../test/factories/index.js";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { TimelineService } from "../timeline/timeline.service.js";
import {
	formatGitHubCommentBody,
	GITHUB_COMMENT_CHAR_LIMIT,
	GitHubCommentService,
	TRUNCATION_MARKER,
} from "./github-comment.service.js";

const REPORT: InvestigationReport = {
	summary: "Connection pool exhausted under sustained traffic.",
	rootCause: "DB_POOL_SIZE dropped from 50 to 5 in deploy 41.",
	rootCauseCategory: "config",
	hypotheses: [
		{
			statement: "Pool size misconfigured",
			status: "confirmed",
			evidence: [
				{
					observation: "DB_POOL_SIZE=5 in manifest",
					source: "git show 41:deploy.yaml",
					direction: "supports",
					status: "verified",
				},
			],
		},
	],
	ruledOut: [],
	coverage: { queried: ["git"], notQueried: ["logs"] },
	nextSteps: [{ title: "Restore pool size", detail: "Set back to 50" }],
};

interface SetupOpts {
	investigation?: {
		id?: string;
		status?: string;
		report?: string | null;
		completedAt?: Date | null;
		incident?: { id: string; number: number; title: string } | null;
	} | null;
	connections?: Array<{
		id: string;
		createdAt?: Date;
		repositories: Array<{ fullName: string }>;
	}>;
	response?: Response | Error;
}

function setup(opts: SetupOpts = {}) {
	const defaultInvestigation = {
		id: "inv-1",
		status: "completed",
		report: JSON.stringify(REPORT),
		completedAt: new Date("2026-09-01T00:00:00Z"),
		incident: { id: "inc-1", number: 7, title: "Checkout 500s" },
	};

	const investigationData =
		opts.investigation !== undefined
			? opts.investigation
			: defaultInvestigation;

	const defaultConnections = [
		{
			id: "conn-1",
			createdAt: new Date(1000),
			repositories: [{ fullName: "prismalens/prismalens" }],
		},
	];

	const connectionsData =
		opts.connections !== undefined ? opts.connections : defaultConnections;

	const prisma = {
		investigation: {
			findUnique: vi.fn(async () => investigationData),
		},
		connection: {
			findMany: vi.fn(async () => connectionsData),
		},
	};

	const defaultResponse = new Response(
		JSON.stringify({
			html_url:
				"https://github.com/prismalens/prismalens/issues/42#issuecomment-999",
		}),
		{ status: 201, headers: { "content-type": "application/json" } },
	);

	const requestFn = vi.fn(
		async (_method: string, _path: string, _options?: unknown) => {
			const res = opts.response ?? defaultResponse;
			if (res instanceof Error) throw res;
			return res;
		},
	);

	const integrations = {
		createRequestFn: vi.fn((_connectionId: string) => requestFn),
	};

	const timeline = {
		create: vi.fn(async () => ({})),
	};

	const telemetry = telemetryStub();

	const service = new GitHubCommentService(
		prisma as unknown as PrismaService,
		integrations as unknown as IntegrationsService,
		timeline as unknown as TimelineService,
		telemetry,
	);

	return {
		service,
		prisma,
		integrations,
		requestFn,
		timeline,
		telemetry,
	};
}

describe("formatGitHubCommentBody", () => {
	it("prefixes the markdown with the incident notice line", () => {
		const body = formatGitHubCommentBody({
			incidentNumber: 7,
			markdown: "# INC-7: Test",
		});
		expect(body).toBe("_Posted by PrismaLens from INC-7_\n\n# INC-7: Test");
	});

	it("truncates content exceeding the limit and adds the marker", () => {
		const longMarkdown = "a".repeat(70_000);
		const body = formatGitHubCommentBody({
			incidentNumber: 7,
			markdown: longMarkdown,
		});
		expect(body.length).toBe(GITHUB_COMMENT_CHAR_LIMIT);
		expect(body.endsWith(TRUNCATION_MARKER)).toBe(true);
	});
});

describe("GitHubCommentService (#606)", () => {
	it("hits /issues/{n}/comments for an issue URL", async () => {
		const { service, requestFn } = setup();

		await service.post(
			"inv-1",
			"https://github.com/prismalens/prismalens/issues/42",
		);

		expect(requestFn).toHaveBeenCalledTimes(1);
		expect(requestFn.mock.calls[0][0]).toBe("POST");
		expect(requestFn.mock.calls[0][1]).toBe(
			"/repos/prismalens/prismalens/issues/42/comments",
		);
	});

	it("hits /issues/{n}/comments for a PR URL", async () => {
		const { service, requestFn } = setup();

		await service.post(
			"inv-1",
			"https://github.com/prismalens/prismalens/pull/123",
		);

		expect(requestFn).toHaveBeenCalledTimes(1);
		expect(requestFn.mock.calls[0][0]).toBe("POST");
		expect(requestFn.mock.calls[0][1]).toBe(
			"/repos/prismalens/prismalens/issues/123/comments",
		);
	});

	it("refuses when investigation has no report (NOT_FOUND)", async () => {
		const { service, requestFn } = setup({
			investigation: { id: "inv-1", report: null, incident: { id: "inc-1", number: 7, title: "T" } },
		});

		await expect(
			service.post(
				"inv-1",
				"https://github.com/prismalens/prismalens/issues/42",
			),
		).rejects.toThrow(ORPCError);

		await expect(
			service.post(
				"inv-1",
				"https://github.com/prismalens/prismalens/issues/42",
			),
		).rejects.toSatisfy((err: unknown) => {
			return (
				err instanceof ORPCError &&
				err.code === "NOT_FOUND" &&
				err.message.includes("has no report")
			);
		});

		expect(requestFn).not.toHaveBeenCalled();
	});

	it("refuses when no GitHub connection is configured (PRECONDITION_FAILED)", async () => {
		const { service, requestFn } = setup({
			connections: [],
		});

		await expect(
			service.post(
				"inv-1",
				"https://github.com/prismalens/prismalens/issues/42",
			),
		).rejects.toSatisfy((err: unknown) => {
			return (
				err instanceof ORPCError &&
				err.code === "PRECONDITION_FAILED" &&
				err.message.includes("No GitHub connection is configured")
			);
		});

		expect(requestFn).not.toHaveBeenCalled();
	});

	it("prefers the repo-matching connection over an older one", async () => {
		const { service, integrations } = setup({
			connections: [
				{
					id: "conn-old",
					createdAt: new Date(1000),
					repositories: [{ fullName: "other-org/other-repo" }],
				},
				{
					id: "conn-match",
					createdAt: new Date(2000),
					repositories: [{ fullName: "prismalens/prismalens" }],
				},
			],
		});

		await service.post(
			"inv-1",
			"https://github.com/prismalens/prismalens/issues/42",
		);

		expect(integrations.createRequestFn).toHaveBeenCalledWith("conn-match");
	});

	it("matches repository case-insensitively", async () => {
		const { service, integrations } = setup({
			connections: [
				{
					id: "conn-old",
					createdAt: new Date(1000),
					repositories: [{ fullName: "other/repo" }],
				},
				{
					id: "conn-case-match",
					createdAt: new Date(2000),
					repositories: [{ fullName: "PRISMALENS/PRISMALENS" }],
				},
			],
		});

		await service.post(
			"inv-1",
			"https://github.com/prismalens/prismalens/issues/42",
		);

		expect(integrations.createRequestFn).toHaveBeenCalledWith(
			"conn-case-match",
		);
	});

	it("falls back to the first connection when no repository matches", async () => {
		const { service, integrations } = setup({
			connections: [
				{
					id: "conn-first",
					createdAt: new Date(1000),
					repositories: [{ fullName: "other/repo1" }],
				},
				{
					id: "conn-second",
					createdAt: new Date(2000),
					repositories: [{ fullName: "other/repo2" }],
				},
			],
		});

		await service.post(
			"inv-1",
			"https://github.com/prismalens/prismalens/issues/42",
		);

		expect(integrations.createRequestFn).toHaveBeenCalledWith("conn-first");
	});

	it("handles 403 with write-permission hint, timeline failure entry, and BAD_GATEWAY", async () => {
		const target = "https://github.com/prismalens/prismalens/issues/42";
		const { service, timeline, telemetry } = setup({
			response: new Response("Forbidden", { status: 403 }),
		});

		await expect(service.post("inv-1", target)).rejects.toSatisfy(
			(err: unknown) => {
				return (
					err instanceof ORPCError &&
					err.code === "BAD_GATEWAY" &&
					err.message.includes("403") &&
					err.message.includes("Issues: write") &&
					err.message.includes("token needs repo scope")
				);
			},
		);

		expect(timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "inc-1",
				type: TimelineEntryType.custom,
				title: "GitHub post failed",
				description: expect.stringContaining(
					"GitHub answered 403 for https://github.com/prismalens/prismalens/issues/42 — a GitHub App needs Issues: write; a token needs repo scope",
				),
				source: TimelineSource.system,
				metadata: { investigationId: "inv-1", target },
			}),
		);

		expect(telemetry.capture).toHaveBeenCalledWith("report_exported", {
			target: "github",
		});
	});

	it("handles network error with timeline entry and BAD_GATEWAY", async () => {
		const target = "https://github.com/prismalens/prismalens/issues/42";
		const { service, timeline, telemetry } = setup({
			response: new TypeError("fetch failed"),
		});

		await expect(service.post("inv-1", target)).rejects.toSatisfy(
			(err: unknown) => {
				return (
					err instanceof ORPCError &&
					err.code === "BAD_GATEWAY" &&
					err.message.includes("GitHub unreachable: fetch failed")
				);
			},
		);

		expect(timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "inc-1",
				type: TimelineEntryType.custom,
				title: "GitHub post failed",
				description: "GitHub unreachable: fetch failed",
				source: TimelineSource.system,
				metadata: { investigationId: "inv-1", target },
			}),
		);

		expect(telemetry.capture).toHaveBeenCalledWith("report_exported", {
			target: "github",
		});
	});

	it("201 creates timeline entry 'Report posted to GitHub' and returns commentUrl", async () => {
		const target = "https://github.com/prismalens/prismalens/issues/42";
		const commentUrl =
			"https://github.com/prismalens/prismalens/issues/42#issuecomment-999";
		const { service, requestFn, timeline, telemetry } = setup({
			response: new Response(JSON.stringify({ html_url: commentUrl }), {
				status: 201,
				headers: { "content-type": "application/json" },
			}),
		});

		const result = await service.post("inv-1", target);

		expect(result).toEqual({ commentUrl });

		expect(timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "inc-1",
				type: TimelineEntryType.custom,
				title: "Report posted to GitHub",
				description: commentUrl,
				source: TimelineSource.system,
				metadata: {
					investigationId: "inv-1",
					target,
					commentUrl,
				},
			}),
		);

		const requestBodyObj = JSON.parse(
			(requestFn.mock.calls[0][2] as { body: string }).body,
		);
		expect(requestBodyObj.body).toContain(
			"_Posted by PrismaLens from INC-7_",
		);
		expect(requestBodyObj.body).toContain("# INC-7: Checkout 500s");

		expect(telemetry.capture).toHaveBeenCalledWith("report_exported", {
			target: "github",
		});
	});

	it("refuses a report whose investigation did not complete (PRECONDITION_FAILED)", async () => {
		const { service, requestFn } = setup({
			investigation: {
				id: "inv-1",
				status: "failed",
				report: JSON.stringify(REPORT),
				completedAt: null,
				incident: { id: "inc-1", number: 7, title: "T" },
			},
		});

		await expect(
			service.post("inv-1", "https://github.com/prismalens/prismalens/issues/42"),
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof ORPCError && err.code === "PRECONDITION_FAILED",
		);
		expect(requestFn).not.toHaveBeenCalled();
	});

	it.each([
		["{}"],
		["null"],
		['{"html_url":"   "}'],
	])("an accepted post with body %s is reported unconfirmed, not as success", async (body) => {
		const target = "https://github.com/prismalens/prismalens/issues/42";
		const { service, requestFn, timeline } = setup({
			response: new Response(body, {
				status: 201,
				headers: { "content-type": "application/json" },
			}),
		});

		await expect(service.post("inv-1", target)).rejects.toSatisfy(
			(err: unknown) => err instanceof ORPCError && err.code === "BAD_GATEWAY",
		);
		expect(requestFn).toHaveBeenCalledTimes(1);
		expect(timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({ title: "GitHub post unconfirmed" }),
		);
	});

	it("a timeline failure after GitHub accepted the post still returns the comment URL", async () => {
		const commentUrl =
			"https://github.com/prismalens/prismalens/issues/42#issuecomment-999";
		const { service, timeline } = setup({
			response: new Response(JSON.stringify({ html_url: commentUrl }), {
				status: 201,
				headers: { "content-type": "application/json" },
			}),
		});
		timeline.create.mockRejectedValueOnce(new Error("db locked"));

		await expect(
			service.post("inv-1", "https://github.com/prismalens/prismalens/issues/42"),
		).resolves.toEqual({ commentUrl });
	});

	it("truncates a 70 000-character report with the marker", async () => {
		const longReport: InvestigationReport = {
			...REPORT,
			summary: "x".repeat(70_000),
		};
		const { service, requestFn } = setup({
			investigation: {
				id: "inv-1",
				status: "completed",
				report: JSON.stringify(longReport),
				completedAt: new Date("2026-09-01T00:00:00Z"),
				incident: { id: "inc-1", number: 7, title: "Long Report" },
			},
		});

		await service.post(
			"inv-1",
			"https://github.com/prismalens/prismalens/issues/42",
		);

		const requestBodyObj = JSON.parse(
			(requestFn.mock.calls[0][2] as { body: string }).body,
		);
		expect(requestBodyObj.body.length).toBeLessThanOrEqual(
			GITHUB_COMMENT_CHAR_LIMIT,
		);
		expect(requestBodyObj.body).toContain("… [truncated]");
		expect(requestBodyObj.body.endsWith("… [truncated]")).toBe(true);
	});
});
