// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readQuota, UsageService } from "./usage.service.js";
import { readTurnUsage } from "./usage.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-usage-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");

type Prisma = InstanceType<typeof PrismaService>;
let prisma: Prisma;
let usageService: UsageService;

beforeAll(async () => {
	const { resolveMigrationsDir, runMigrations } = await import(
		"@prismalens/database/migrator"
	);
	await runMigrations({
		migrationsDir: resolveMigrationsDir(),
		log: () => {},
	});
	prisma = new PrismaService();
	await prisma.$connect();
	usageService = new UsageService(prisma);
});

afterAll(async () => {
	await prisma?.$disconnect();
	rmSync(env.root, { recursive: true, force: true });
});

beforeEach(async () => {
	await prisma.investigationEvent.deleteMany();
	await prisma.investigation.deleteMany();
	await prisma.repository.deleteMany();
});

describe("UsageService", () => {
	describe("summary", () => {
		it("seeds two investigations, turn_usage inside and outside range, and computes totals, models, days, silentAgents, and scopes", async () => {
			const repo = await prisma.repository.create({
				data: {
					fullName: "acme/backend",
					url: "https://github.com/acme/backend.git",
				},
			});

			const now = new Date("2026-11-12T12:00:00.000Z");
			const threeDaysAgo = new Date("2026-11-09T12:00:00.000Z");
			const tenDaysAgo = new Date("2026-11-02T12:00:00.000Z");

			// Thread 1: claude-code with repositoryId
			const thread1 = await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "claude-code",
					model: "claude-3-7-sonnet",
					repositoryId: repo.id,
					updatedAt: threeDaysAgo,
				},
			});

			// Thread 2: codex without repositoryId
			const thread2 = await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "codex",
					model: "gpt-4o",
					updatedAt: threeDaysAgo,
				},
			});

			// Thread 3: gemini-cli ran in range (updatedAt in range) but has no turn_usage events (silent agent)
			await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "gemini-cli",
					model: "gemini-1.5-pro",
					updatedAt: threeDaysAgo,
				},
			});

			// Event inside range for thread1
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread1.id,
					branchId: "__report__",
					seq: 1,
					createdAt: threeDaysAgo,
					event: JSON.stringify({
						kind: "turn_usage",
						usage: {
							inputTokens: 100,
							outputTokens: 50,
							totalTokens: 150,
							cost: { amount: 0.015, currency: "USD" },
							model: "claude-3-7-sonnet",
						},
					}),
				},
			});

			// Event outside range for thread1 (10 days ago)
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread1.id,
					branchId: "__report__",
					seq: 2,
					createdAt: tenDaysAgo,
					event: JSON.stringify({
						kind: "turn_usage",
						usage: {
							inputTokens: 1000,
							outputTokens: 500,
							totalTokens: 1500,
							cost: { amount: 0.15, currency: "USD" },
							model: "claude-3-7-sonnet",
						},
					}),
				},
			});

			// Event inside range for thread2
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread2.id,
					branchId: "__report__",
					seq: 1,
					createdAt: threeDaysAgo,
					event: JSON.stringify({
						kind: "turn_usage",
						usage: {
							inputTokens: 200,
							outputTokens: 100,
							totalTokens: 300,
							cost: { amount: 0.03, currency: "USD" },
							model: "gpt-4o",
						},
					}),
				},
			});

			// Unscoped summary for 7d
			const summary = await usageService.summary({ range: "7d" }, now);
			expect(summary.range).toBe("7d");
			expect(summary.step).toBe("day");
			expect(summary.threads).toBe(2);
			expect(summary.totals.turns).toBe(2);
			expect(summary.totals.tokens.input).toBe(300);
			expect(summary.totals.tokens.output).toBe(150);
			expect(summary.totals.tokens.total).toBe(450);
			expect(summary.totals.cost.amount).toBe(0.045);
			expect(summary.days.length).toBe(8);

			expect(summary.models.length).toBe(2);
			expect(summary.models[0]?.agent).toBe("codex");
			expect(summary.models[0]?.model).toBe("gpt-4o");
			expect(summary.models[0]?.tokens.total).toBe(300);

			expect(summary.models[1]?.agent).toBe("claude-code");
			expect(summary.models[1]?.model).toBe("claude-3-7-sonnet");
			expect(summary.models[1]?.tokens.total).toBe(150);

			expect(summary.silentAgents).toEqual(["gemini-cli"]);
			expect(summary.projects).toEqual([{ id: repo.id, name: "acme/backend" }]);

			// Scoped by agent: claude-code
			const agentScoped = await usageService.summary(
				{ range: "7d", agent: "claude-code" },
				now,
			);
			expect(agentScoped.threads).toBe(1);
			expect(agentScoped.totals.tokens.total).toBe(150);
			expect(agentScoped.models.length).toBe(1);
			expect(agentScoped.models[0]?.agent).toBe("claude-code");

			// Scoped by project
			const projectScoped = await usageService.summary(
				{ range: "7d", project: repo.id },
				now,
			);
			expect(projectScoped.threads).toBe(1);
			expect(projectScoped.totals.tokens.total).toBe(150);
			expect(projectScoped.models.length).toBe(1);
			expect(projectScoped.models[0]?.agent).toBe("claude-code");
		});

		it("with project set returns only that project's threads; a turn_usage whose usage fails the schema adds nothing", async () => {
			const repoA = await prisma.repository.create({
				data: { fullName: "acme/proj-a", url: "https://github.com/acme/proj-a.git" },
			});
			const repoB = await prisma.repository.create({
				data: { fullName: "acme/proj-b", url: "https://github.com/acme/proj-b.git" },
			});
			const now = new Date("2026-11-12T12:00:00.000Z");
			const recent = new Date("2026-11-12T10:00:00.000Z");

			const threadA = await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "codex",
					model: "gpt-4o",
					repositoryId: repoA.id,
					updatedAt: recent,
				},
			});
			const threadB = await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "codex",
					model: "gpt-4o",
					repositoryId: repoB.id,
					updatedAt: recent,
				},
			});

			// Valid turn_usage for threadA
			await prisma.investigationEvent.create({
				data: {
					investigationId: threadA.id,
					branchId: "__report__",
					seq: 1,
					createdAt: recent,
					event: JSON.stringify({
						kind: "turn_usage",
						usage: {
							inputTokens: 10,
							outputTokens: 5,
							totalTokens: 15,
							model: "gpt-4o",
						},
					}),
				},
			});

			// Invalid turn_usage for threadA (usage fails schema)
			await prisma.investigationEvent.create({
				data: {
					investigationId: threadA.id,
					branchId: "__report__",
					seq: 2,
					createdAt: recent,
					event: JSON.stringify({
						kind: "turn_usage",
						usage: "invalid-usage-payload",
					}),
				},
			});

			// Valid turn_usage for threadB
			await prisma.investigationEvent.create({
				data: {
					investigationId: threadB.id,
					branchId: "__report__",
					seq: 1,
					createdAt: recent,
					event: JSON.stringify({
						kind: "turn_usage",
						usage: {
							inputTokens: 100,
							outputTokens: 50,
							totalTokens: 150,
							model: "gpt-4o",
						},
					}),
				},
			});

			const summary = await usageService.summary({ range: "24h", project: repoA.id }, now);
			expect(summary.threads).toBe(1);
			expect(summary.totals.turns).toBe(1);
			expect(summary.totals.tokens.input).toBe(10);
			expect(summary.totals.tokens.output).toBe(5);
			expect(summary.totals.tokens.total).toBe(15);
		});
	});

	describe("limits", () => {
		it("two agent_quota events for one window keep the newest, agent without quota has empty windows, usedPercent 140 clamps to 100", async () => {
			const thread = await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "codex",
				},
			});

			// Agent with runs but no quota events
			await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "opencode",
				},
			});

			const older = new Date("2026-11-12T10:00:00.000Z");
			const newer = new Date("2026-11-12T11:00:00.000Z");

			// First event (older): 50%
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "__report__",
					seq: 1,
					createdAt: older,
					event: JSON.stringify({
						kind: "agent_quota",
						window: "daily",
						usedPercent: 50,
					}),
				},
			});

			// Second event (newer): 140% used (should clamp to 100)
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "__report__",
					seq: 2,
					createdAt: newer,
					event: JSON.stringify({
						kind: "agent_quota",
						window: "daily",
						usedPercent: 140,
					}),
				},
			});

			const limits = await usageService.limits();
			const codex = limits.agents.find((a) => a.agent === "codex");
			expect(codex).toBeDefined();
			expect(codex?.windows.length).toBe(1);
			expect(codex?.windows[0]?.window).toBe("daily");
			expect(codex?.windows[0]?.usedPercent).toBe(100);
			expect(codex?.windows[0]?.at).toBe(newer.toISOString());

			const opencode = limits.agents.find((a) => a.agent === "opencode");
			expect(opencode).toBeDefined();
			expect(opencode?.windows).toEqual([]);
		});

		it("sorts windows by kind: session, weekly, then the one with no window", async () => {
			const thread = await prisma.investigation.create({
				data: { status: "running", kind: "chat", harness: "codex" },
			});
			const now = new Date("2026-11-12T10:00:00.000Z");

			// window-less quota event (window: null or unknown window)
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "__report__",
					seq: 1,
					createdAt: now,
					event: JSON.stringify({
						kind: "agent_quota",
						type: "custom-no-window",
						window: "unknown-window",
						usedPercent: 10,
					}),
				},
			});

			// weekly window
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "__report__",
					seq: 2,
					createdAt: now,
					event: JSON.stringify({
						kind: "agent_quota",
						window: "weekly",
						usedPercent: 20,
					}),
				},
			});

			// session window
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "__report__",
					seq: 3,
					createdAt: now,
					event: JSON.stringify({
						kind: "agent_quota",
						window: "session",
						usedPercent: 30,
					}),
				},
			});

			const limits = await usageService.limits();
			const codex = limits.agents.find((a) => a.agent === "codex");
			expect(codex?.windows.map((w) => w.window)).toEqual(["session", "weekly", null]);
		});

		it("skips an agent_quota event whose JSON is unreadable, and one on a thread with no harness", async () => {
			const threadWithHarness = await prisma.investigation.create({
				data: { status: "running", kind: "chat", harness: "claude-code" },
			});
			const threadWithoutHarness = await prisma.investigation.create({
				data: { status: "running", kind: "chat", harness: null },
			});
			const now = new Date("2026-11-12T10:00:00.000Z");

			// Unreadable JSON on valid thread
			await prisma.investigationEvent.create({
				data: {
					investigationId: threadWithHarness.id,
					branchId: "__report__",
					seq: 1,
					createdAt: now,
					event: "{not-valid-json",
				},
			});

			// Valid agent_quota on thread without harness
			await prisma.investigationEvent.create({
				data: {
					investigationId: threadWithoutHarness.id,
					branchId: "__report__",
					seq: 1,
					createdAt: now,
					event: JSON.stringify({
						kind: "agent_quota",
						window: "daily",
						usedPercent: 50,
					}),
				},
			});

			// Valid agent_quota on thread with harness
			await prisma.investigationEvent.create({
				data: {
					investigationId: threadWithHarness.id,
					branchId: "__report__",
					seq: 2,
					createdAt: now,
					event: JSON.stringify({
						kind: "agent_quota",
						window: "daily",
						usedPercent: 75,
					}),
				},
			});

			const limits = await usageService.limits();
			const claude = limits.agents.find((a) => a.agent === "claude-code");
			expect(claude?.windows.length).toBe(1);
			expect(claude?.windows[0]?.usedPercent).toBe(75);
			expect(limits.agents.find((a) => a.agent === null)).toBeUndefined();
		});
	});

	describe("enforcement", () => {
		it("groups reports with fidelity by agent and level with runs counted, skipping reports without fidelity", async () => {
			// Run 1: codex with supervised
			await prisma.investigation.create({
				data: {
					status: "completed",
					kind: "chat",
					harness: "codex",
					report: JSON.stringify({
						fidelity: {
							harness: "codex",
							mode: "full",
							fidelity: "enforced",
							mechanism: "sandbox",
							ranAccess: "supervised",
						},
					}),
				},
			});

			// Run 2: codex with supervised again
			await prisma.investigation.create({
				data: {
					status: "completed",
					kind: "chat",
					harness: "codex",
					report: JSON.stringify({
						fidelity: {
							harness: "codex",
							mode: "full",
							fidelity: "enforced",
							mechanism: "sandbox",
							ranAccess: "supervised",
						},
					}),
				},
			});

			// Run 3: claude-code with full access
			await prisma.investigation.create({
				data: {
					status: "completed",
					kind: "chat",
					harness: "claude-code",
					report: JSON.stringify({
						fidelity: {
							harness: "claude-code",
							mode: "bypass",
							fidelity: "advisory",
							mechanism: "none",
							ranAccess: "full-access",
						},
					}),
				},
			});

			// Run 4: report without fidelity (should be skipped)
			await prisma.investigation.create({
				data: {
					status: "completed",
					kind: "chat",
					harness: "opencode",
					report: JSON.stringify({ summary: "No fidelity here" }),
				},
			});

			const enforcement = await usageService.enforcement();
			expect(enforcement.rows.length).toBe(2);

			const codexRow = enforcement.rows.find((r) => r.agent === "codex");
			expect(codexRow).toBeDefined();
			expect(codexRow?.access).toBe("supervised");
			expect(codexRow?.runs).toBe(2);
			expect(codexRow?.fidelity).toBe("enforced");
			expect(codexRow?.mechanism).toBe("sandbox");

			const claudeRow = enforcement.rows.find((r) => r.agent === "claude-code");
			expect(claudeRow).toBeDefined();
			expect(claudeRow?.access).toBe("full-access");
			expect(claudeRow?.runs).toBe(1);
			expect(claudeRow?.fidelity).toBe("advisory");
			expect(claudeRow?.mechanism).toBe("none");
		});

		it("skips a report that is not JSON, and one whose fidelity lacks both access and ranAccess; a report with access only groups under access", async () => {
			// Run 1: report is not JSON (unparsable)
			await prisma.investigation.create({
				data: {
					status: "completed",
					kind: "chat",
					harness: "codex",
					report: "not-json{",
				},
			});

			// Run 2: fidelity lacks both access and ranAccess (access is null/undefined, ranAccess is null/undefined)
			await prisma.investigation.create({
				data: {
					status: "completed",
					kind: "chat",
					harness: "codex",
					report: JSON.stringify({
						fidelity: {
							harness: "codex",
							mode: "full",
							fidelity: "enforced",
							mechanism: "sandbox",
						},
					}),
				},
			});

			// Run 3: report with access only (no ranAccess) groups under access
			await prisma.investigation.create({
				data: {
					status: "completed",
					kind: "chat",
					harness: "codex",
					report: JSON.stringify({
						fidelity: {
							harness: "codex",
							mode: "full",
							fidelity: "enforced",
							mechanism: "sandbox",
							access: "auto",
						},
					}),
				},
			});

			const enforcement = await usageService.enforcement();
			expect(enforcement.rows.length).toBe(1);
			expect(enforcement.rows[0]?.agent).toBe("codex");
			expect(enforcement.rows[0]?.access).toBe("auto");
			expect(enforcement.rows[0]?.runs).toBe(1);
		});
	});

	describe("readQuota", () => {
		it("a non-number usedPercent gives usedPercent: null; an unparsable resetsAt gives resetsAt: null; an unknown window gives window: null; a non-agent_quota kind gives null", () => {
			const at = new Date("2026-11-12T10:00:00.000Z");

			// non-number usedPercent
			const nonNumberUsed = readQuota(
				JSON.stringify({ kind: "agent_quota", window: "daily", usedPercent: "fifty" }),
				at,
			);
			expect(nonNumberUsed?.usedPercent).toBeNull();
			expect(nonNumberUsed?.window).toBe("daily");

			// unparsable resetsAt
			const unparsableReset = readQuota(
				JSON.stringify({ kind: "agent_quota", window: "daily", resetsAt: "invalid-date" }),
				at,
			);
			expect(unparsableReset?.resetsAt).toBeNull();

			// unknown window
			const unknownWindow = readQuota(
				JSON.stringify({ kind: "agent_quota", window: "not-a-window" }),
				at,
			);
			expect(unknownWindow?.window).toBeNull();

			// non-agent_quota kind
			const nonAgentQuota = readQuota(
				JSON.stringify({ kind: "turn_usage" }),
				at,
			);
			expect(nonAgentQuota).toBeNull();

			// invalid JSON
			const invalidJson = readQuota("not-json{", at);
			expect(invalidJson).toBeNull();
		});
	});

	describe("readTurnUsage", () => {
		it("readTurnUsage with unparsable JSON returns null", () => {
			expect(readTurnUsage("not-json{")).toBeNull();
			expect(readTurnUsage(JSON.stringify({ kind: "other_kind" }))).toBeNull();
		});
	});
});
