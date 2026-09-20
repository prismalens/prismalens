// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationReport } from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { CredentialsService } from "../integrations/crypto/credentials.service.js";
import type { TimelineService } from "../timeline/timeline.service.js";
import {
	escapeSlack,
	ReportDeliveryService,
	slackMessage,
} from "./report-delivery.service.js";

const REPORT: InvestigationReport = {
	summary: "Pool exhausted <!channel>",
	rootCause: "DB_POOL_SIZE dropped to 5 & <https://evil|here>",
	rootCauseCategory: "config",
	hypotheses: [],
	ruledOut: [],
	coverage: { queried: [], notQueried: [] },
	nextSteps: [{ title: "Restore pool size", detail: "to 50" }],
};

const HOOK = "https://hooks.slack.com/services/T0/B0/xyz";

function setup(opts: { configured?: boolean; response?: Response | Error } = {}) {
	const rows = new Map<string, { value: string }>();
	if (opts.configured !== false) {
		rows.set("REPORT_DELIVERY", {
			value: JSON.stringify({ slackWebhookUrlEnc: `enc:${HOOK}` }),
		});
	}
	const prisma = {
		setting: {
			findUnique: vi.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
			upsert: vi.fn(async ({ create }: { create: { key: string; value: string } }) => {
				rows.set(create.key, { value: create.value });
			}),
		},
		investigation: {
			findUnique: vi.fn(async () => ({
				status: "completed",
				report: JSON.stringify(REPORT),
				error: null,
				incident: { id: "inc-1", number: 7, title: "Checkout 500s" },
			})),
		},
	};
	const credentials = {
		encryptToBase64: (v: string) => `enc:${v}`,
		decryptFromBase64: (v: string) => v.replace(/^enc:/, ""),
	};
	const timeline = { create: vi.fn(async () => ({})) };
	const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => {
		const r = opts.response ?? new Response("ok", { status: 200 });
		if (r instanceof Error) throw r;
		return r;
	});
	const service = new ReportDeliveryService(
		prisma as unknown as PrismaService,
		credentials as unknown as CredentialsService,
		timeline as unknown as TimelineService,
		fetchImpl as unknown as typeof fetch,
	);
	return { service, fetchImpl, timeline, prisma, rows };
}

describe("slackMessage (#606)", () => {
	it("posts title, summary, root cause and the first next step, escaped", () => {
		const text = slackMessage({
			status: "completed",
			incident: { id: "i", number: 7, title: "Checkout <500s>" },
			report: REPORT,
			error: null,
		});
		expect(text).toBe(
			[
				"*INC-7: Checkout &lt;500s&gt;*",
				"*Summary:* Pool exhausted &lt;!channel&gt;",
				"*Root cause:* DB_POOL_SIZE dropped to 5 &amp; &lt;https://evil|here&gt;",
				"*Next step:* Restore pool size",
			].join("\n"),
		);
	});

	it("says a failed run failed, with its error", () => {
		expect(
			slackMessage({
				status: "failed",
				incident: { id: "i", number: 3, title: "t" },
				report: null,
				error: "No coding agent found",
			}),
		).toBe("*INC-3: t*\nInvestigation failed: No coding agent found");
	});

	it("escapes only Slack's three control characters", () => {
		expect(escapeSlack("a & <b> c")).toBe("a &amp; &lt;b&gt; c");
	});
});

describe("ReportDeliveryService (#606)", () => {
	it("does nothing until a webhook is set", async () => {
		const { service, fetchImpl } = setup({ configured: false });
		await service.deliver("inv-1");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("posts once per investigation to the stored webhook", async () => {
		const { service, fetchImpl } = setup();
		await service.deliver("inv-1");
		await service.deliver("inv-1");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl.mock.calls[0][0]).toBe(HOOK);
		expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body)).text).toContain(
			"INC-7",
		);
	});

	it("records a refused post on the incident timeline and never throws", async () => {
		const { service, timeline } = setup({
			response: new Response("invalid_token", { status: 403 }),
		});
		await expect(service.deliver("inv-1")).resolves.toBeUndefined();
		expect(timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "inc-1",
				title: "Slack delivery failed",
				description: "Slack answered 403: invalid_token",
			}),
		);
	});

	it("records an unreachable Slack the same way", async () => {
		const { service, timeline } = setup({ response: new TypeError("fetch failed") });
		await service.deliver("inv-1");
		expect(timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Slack unreachable: fetch failed" }),
		);
	});

	it("stores the URL encrypted and reports only whether one is set", async () => {
		const { service, rows } = setup({ configured: false });
		expect(await service.setSlackWebhook(HOOK)).toEqual({ slackConfigured: true });
		// Stored only through the vault (the fake vault prefixes "enc:").
		expect(JSON.parse(rows.get("REPORT_DELIVERY")?.value ?? "{}")).toEqual({
			slackWebhookUrlEnc: `enc:${HOOK}`,
		});
		expect(await service.setSlackWebhook(null)).toEqual({ slackConfigured: false });
	});
});
