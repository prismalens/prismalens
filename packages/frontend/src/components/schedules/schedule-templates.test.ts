// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadStartSubject } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { SCHEDULE_TEMPLATES } from "./schedule-templates";

describe("SCHEDULE_TEMPLATES (#1101)", () => {
	const subject: ThreadStartSubject = {
		kind: "service",
		serviceId: "11111111-1111-4111-8111-111111111111",
	};

	it("watch-service prefill gives exact name, when, report and subject", () => {
		const template = SCHEDULE_TEMPLATES.find((t) => t.id === "watch-service");
		if (!template) throw new Error("watch-service template not found");
		const prefill = template.prefill(subject);
		expect(prefill.name).toBe("Watch a service");
		expect(prefill.when).toEqual({ preset: "hours", everyHours: 2 });
		expect(prefill.report).toBe(true);
		expect(prefill.subject).toEqual(subject);
		expect(prefill.brief).toBe(
			"Check this service's recent errors, alerts and deploys. Say whether anything new is wrong, with the evidence, or that nothing is.",
		);
	});

	it("daily-digest prefill gives exact name, when, report and subject", () => {
		const template = SCHEDULE_TEMPLATES.find((t) => t.id === "daily-digest");
		if (!template) throw new Error("daily-digest template not found");
		const prefill = template.prefill(subject);
		expect(prefill.name).toBe("Daily digest");
		expect(prefill.when).toEqual({
			preset: "weekdays",
			time: "09:00",
			days: [1, 2, 3, 4, 5],
		});
		expect(prefill.report).toBe(false);
		expect(prefill.subject).toEqual(subject);
		expect(prefill.brief).toBe(
			"Summarize what changed since yesterday: incidents, alerts, deploys and open pull requests. Lead with anything that needs me.",
		);
	});

	it("recheck-pr prefill gives exact name, when, report, subject, and puts given URL in brief", () => {
		const template = SCHEDULE_TEMPLATES.find((t) => t.id === "recheck-pr");
		if (!template) throw new Error("recheck-pr template not found");
		const url = "https://github.com/prismalens/prismalens/pull/1101";
		const prefillWithUrl = template.prefill(subject, url);
		expect(prefillWithUrl.name).toBe("Re-check a PR");
		expect(prefillWithUrl.when).toEqual({ preset: "hours", everyHours: 1 });
		expect(prefillWithUrl.report).toBe(false);
		expect(prefillWithUrl.subject).toEqual(subject);
		expect(prefillWithUrl.brief).toBe(
			`Re-check the pull request ${url}: its checks, open review threads and merge state. Say what blocks the merge and the next command.`,
		);

		const prefillWithoutUrl = template.prefill(subject);
		expect(prefillWithoutUrl.brief).toBe(
			"Re-check the pull request (paste its link here): its checks, open review threads and merge state. Say what blocks the merge and the next command.",
		);
	});
});
