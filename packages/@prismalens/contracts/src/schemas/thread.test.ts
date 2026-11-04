// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	InvestigationContextSchema,
	InvestigationJobDataSchema,
	threadChatContext,
} from "./investigation.js";
import { AddRepositorySourceSchema } from "./repository.js";
import { StartThreadSchema, ThreadListQuerySchema } from "./thread.js";

const REPO = "11111111-1111-4111-8111-111111111111";

describe("threads on a project, a service or nothing (#1020)", () => {
	it("a coding chat's context has no alert and needs none", () => {
		const built = threadChatContext(
			{ subject: "project", name: "shop" },
			{ telemetry: { prometheusUrl: "http://prom:9090" } },
		);
		expect(InvestigationContextSchema.parse(built)).toMatchObject({
			mode: "project-chat",
			alerts: [],
			thread: { subject: "project", name: "shop" },
		});
		expect(built.service).toBeUndefined();
		expect(
			threadChatContext({ subject: "service", name: "checkout" }, { service: { name: "checkout" } }).service,
		).toEqual({ name: "checkout" });
	});

	it("still refuses an incident context with no alert", () => {
		expect(InvestigationContextSchema.safeParse({ alerts: [] }).success).toBe(false);
	});

	it("a job carries the thread's frozen subject", () => {
		const job = InvestigationJobDataSchema.parse({
			incidentId: null,
			investigationId: "inv",
			thread: { subject: "project", repositoryId: REPO, serviceId: null, name: "shop", repos: [] },
			kind: "chat",
			chat: { text: "hi" },
		});
		expect(job.thread?.subject).toBe("project");
	});

	it("starts with a subject and a message; files ride under a draft key", () => {
		expect(
			StartThreadSchema.parse({ subject: { kind: "project", repositoryId: REPO }, text: "  hi  " }).text,
		).toBe("hi");
		expect(StartThreadSchema.safeParse({ subject: { kind: "none" }, text: "" }).success).toBe(false);
		expect(StartThreadSchema.safeParse({ subject: { kind: "project" }, text: "hi" }).success).toBe(false);
		expect(ThreadListQuerySchema.parse({ repositoryId: REPO }).limit).toBe(50);
	});

	it("adds a project with no service", () => {
		expect(AddRepositorySourceSchema.parse({ source: "/code/shop" })).toEqual({ source: "/code/shop" });
	});
});
