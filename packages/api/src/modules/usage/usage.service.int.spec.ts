// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { rmSync } from "node:fs";
import type { ModelPrice } from "@prismalens/contracts";
import type { LimitRead } from "@prismalens/engine";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { harnessLimitSource } from "./limit-reads.js";
import { readQuota, UsageService } from "./usage.service.js";
import { readTurnUsage } from "./usage.js";

vi.setConfig({ testTimeout: 5_000 }); // slowest test 544 ms; 3x, rounded up to the second, at least 5 s (#1154)

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

	describe("limits (#1171)", () => {
		it("reports limits for installed and ran agents, categorizing empty reasons", async () => {
			const mockHarness = {
				installedIds: vi.fn(async () => ["claude-code", "opencode", "codex"]),
			};
			const svcWithHarness = new UsageService(
				prisma,
				mockHarness as unknown as InstanceType<typeof import("../../core/harness/harness.service.js").HarnessService>,
			);

			const thread = await prisma.investigation.create({
				data: {
					status: "running",
					kind: "chat",
					harness: "codex",
					model: "gpt-4o",
				},
			});
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "__report__",
					seq: 1,
					event: JSON.stringify({
						kind: "agent_quota",
						window: "daily",
						usedPercent: 42,
					}),
				},
			});

			const res = await svcWithHarness.limits();
			const agentNames = res.agents.map((a) => a.agent);
			expect(agentNames).toEqual(["claude-code", "codex", "opencode"]);
			expect(new Set(agentNames).size).toBe(agentNames.length);

			const claude = res.agents.find((a) => a.agent === "claude-code");
			expect(claude?.empty).toBe("no-run-yet");
			expect(claude?.windows).toEqual([]);

			const opencode = res.agents.find((a) => a.agent === "opencode");
			expect(opencode?.empty).toBe("not-reported");
			expect(opencode?.windows).toEqual([]);

			const codex = res.agents.find((a) => a.agent === "codex");
			expect(codex?.empty).toBeNull();
			expect(codex?.windows).toHaveLength(1);
			expect(codex?.windows[0]?.window).toBe("daily");
			expect(codex?.windows[0]?.usedPercent).toBe(42);
		});
	});
});

describe("limit reads before a run (#1180)", () => {
	const T0 = "2026-11-26T10:00:00.000Z";
	const T1 = "2026-11-26T10:05:00.000Z";
	const T2 = "2026-11-26T10:10:00.000Z";

	const read = (account: string, at: string): LimitRead => ({
		account,
		at,
		windows: [
			{
				key: "five_hour:session",
				window: "session",
				type: "five_hour",
				usedPercent: 30,
				resetsAt: "2026-11-26T12:00:00.000Z",
				status: null,
			},
			{
				key: "seven_day:weekly",
				window: "weekly",
				type: "seven_day",
				usedPercent: 60,
				resetsAt: "2026-11-30T00:00:00.000Z",
				status: null,
			},
		],
	});

	/** A source over the real HARNESS_CHECKS mapping, with a scripted check and scripted reads. */
	function source(opts: {
		check?: { label: string; email: string | null; at: string } | null;
		runtime?: () => string;
		reads: (LimitRead | null)[];
	}) {
		const runtime = opts.runtime ?? (() => "rt-1");
		const read = vi.fn(async () => opts.reads.shift() ?? null);
		const models = {
			checked: () =>
				opts.check
					? {
							at: opts.check.at,
							account: {
								label: opts.check.label,
								email: opts.check.email,
								organization: null,
							},
						}
					: null,
		};
		const harness = {
			runtimeFor: async () => ({ env: {}, note: null }),
			runtimeKey: () => runtime(),
		};
		return { source: harnessLimitSource(harness, models, read), read };
	}

	const claudeOf = <A extends { agent: string }>(l: { agents: A[] }) =>
		l.agents.find((a) => a.agent === "claude-code");

	beforeEach(async () => {
		await prisma.setting.deleteMany({
			where: { key: { in: ["AGENT_LIMIT_READS", "USAGE_PRICES"] } },
		});
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(T1));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows a read with its Checked time and source, keyed by window", async () => {
		const { source: s } = source({ reads: [read("a@example.test", T0)] });
		const svc = new UsageService(prisma, undefined, s);
		const claude = await svc.readLimits("claude-code");
		expect(claude).toEqual({
			agent: "claude-code",
			windows: [
				{
					window: "session",
					type: "five_hour",
					usedPercent: 30,
					resetsAt: "2026-11-26T12:00:00.000Z",
					status: null,
					at: T0,
					key: "five_hour:session",
					via: "check",
				},
				{
					window: "weekly",
					type: "seven_day",
					usedPercent: 60,
					resetsAt: "2026-11-30T00:00:00.000Z",
					status: null,
					at: T0,
					key: "seven_day:weekly",
					via: "check",
				},
			],
			empty: null,
			checkedAt: T0,
			triedAt: null,
		});
	});

	it("hides a read of one account once a newer check names another with the same label", async () => {
		const reads = [read("a@example.test", T0)];
		const first = source({
			check: { label: "Claude Max", email: "a@example.test", at: T0 },
			reads,
		});
		await new UsageService(prisma, undefined, first.source).readLimits(
			"claude-code",
		);
		const other = source({
			check: { label: "Claude Max", email: "b@example.test", at: T1 },
			reads: [],
		});
		const claude = claudeOf(
			await new UsageService(prisma, undefined, other.source).limits(),
		);
		expect(claude).toEqual({
			agent: "claude-code",
			windows: [],
			empty: "no-run-yet",
			checkedAt: null,
			triedAt: null,
		});
		const same = source({
			check: { label: "Claude Max", email: "a@example.test", at: T1 },
			reads: [],
		});
		expect(
			claudeOf(await new UsageService(prisma, undefined, same.source).limits())
				?.checkedAt,
		).toBe(T0);
	});

	it("hides a read once the agent's runtime changed", async () => {
		let rt = "rt-1";
		const { source: s } = source({
			runtime: () => rt,
			reads: [read("a@example.test", T0)],
		});
		const svc = new UsageService(prisma, undefined, s);
		await svc.readLimits("claude-code");
		rt = "rt-2";
		expect(claudeOf(await svc.limits())?.windows).toEqual([]);
	});

	it("keeps the read's other windows when a newer run reports one window of the same account", async () => {
		const { source: s } = source({ reads: [read("a@example.test", T0)] });
		const svc = new UsageService(prisma, undefined, s);
		await svc.readLimits("claude-code");
		const thread = await prisma.investigation.create({
			data: { status: "running", kind: "chat", harness: "claude-code" },
		});
		await prisma.investigationEvent.create({
			data: {
				investigationId: thread.id,
				branchId: "main",
				seq: 1,
				createdAt: new Date(T2),
				event: JSON.stringify({
					kind: "agent_quota",
					window: "session",
					type: "five_hour",
					usedPercent: 45,
					account: "a@example.test",
				}),
			},
		});
		const claude = claudeOf(await svc.limits());
		expect(
			claude?.windows.map((w) => [w.key, w.usedPercent, w.at, w.via]),
		).toEqual([
			["five_hour:session", 45, T2, "run"],
			["seven_day:weekly", 60, T0, "check"],
		]);
		expect(claude?.checkedAt).toBe(T0);
	});

	it("leaves out a run window of another account, and an account-less one older than the read", async () => {
		const { source: s } = source({ reads: [read("a@example.test", T1)] });
		const svc = new UsageService(prisma, undefined, s);
		await svc.readLimits("claude-code");
		const thread = await prisma.investigation.create({
			data: { status: "running", kind: "chat", harness: "claude-code" },
		});
		const quota = (seq: number, at: string, extra: object) =>
			prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "main",
					seq,
					createdAt: new Date(at),
					event: JSON.stringify({
						kind: "agent_quota",
						window: "session",
						type: "five_hour",
						usedPercent: 99,
						...extra,
					}),
				},
			});
		// A key the read doesn't hold, so only the account rule can leave it out.
		await quota(1, T0, { window: "model", type: "older" });
		await quota(2, T2, { account: "b@example.test" });
		expect(
			claudeOf(await svc.limits())?.windows.map((w) => [w.key, w.via]),
		).toEqual([
			["five_hour:session", "check"],
			["seven_day:weekly", "check"],
		]);
	});

	it("with no account known, keeps only the newest run's account in the row", async () => {
		const svc = new UsageService(prisma);
		const thread = await prisma.investigation.create({
			data: { status: "running", kind: "chat", harness: "claude-code" },
		});
		const quota = (seq: number, at: string, extra: object) =>
			prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "main",
					seq,
					createdAt: new Date(at),
					event: JSON.stringify({
						kind: "agent_quota",
						window: "session",
						type: "five_hour",
						usedPercent: 40,
						...extra,
					}),
				},
			});
		await quota(1, T0, { account: "a@example.test" });
		await quota(2, T1, { account: "b@example.test", window: "weekly", type: "seven_day" });
		expect(
			claudeOf(await svc.limits())?.windows.map((w) => [w.key, w.via]),
		).toEqual([["seven_day:weekly", "run"]]);
	});

	it("keeps the checked account's run window when another account reports that window later", async () => {
		const { source: s } = source({ reads: [read("a@example.test", T0)] });
		const svc = new UsageService(prisma, undefined, s);
		await svc.readLimits("claude-code");
		const thread = await prisma.investigation.create({
			data: { status: "running", kind: "chat", harness: "claude-code" },
		});
		const quota = (seq: number, at: string, account: string, used: number) =>
			prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "main",
					seq,
					createdAt: new Date(at),
					event: JSON.stringify({
						kind: "agent_quota",
						window: "session",
						type: "five_hour",
						usedPercent: used,
						account,
					}),
				},
			});
		await quota(1, T1, "a@example.test", 45);
		await quota(2, T2, "b@example.test", 99);
		expect(
			claudeOf(await svc.limits())?.windows.map((w) => [
				w.key,
				w.usedPercent,
				w.at,
				w.via,
			]),
		).toEqual([
			["five_hour:session", 45, T1, "run"],
			["seven_day:weekly", 60, T0, "check"],
		]);
	});

	it("keeps the last read when a later one fails, with the failed try's time", async () => {
		const { source: s } = source({
			reads: [read("a@example.test", T0), null],
		});
		const svc = new UsageService(prisma, undefined, s);
		await svc.readLimits("claude-code");
		vi.setSystemTime(new Date(T2));
		const claude = await svc.readLimits("claude-code");
		expect(claude.windows.map((w) => [w.key, w.usedPercent])).toEqual([
			["five_hour:session", 30],
			["seven_day:weekly", 60],
		]);
		expect(claude.checkedAt).toBe(T0);
		expect(claude.triedAt).toBe(T2);
	});

	it("starts no read for an agent without one, and one read for two asks at once", async () => {
		const { source: s, read: fn } = source({
			reads: [read("a@example.test", T0)],
		});
		const svc = new UsageService(prisma, undefined, s);
		await svc.readLimits("opencode");
		expect(fn).not.toHaveBeenCalled();
		await Promise.all([
			svc.readLimits("claude-code"),
			svc.readLimits("claude-code"),
		]);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});

describe("API estimates for unpriced turns (#1180)", () => {
	const NOW = new Date("2026-11-26T12:00:00.000Z");
	const price = (
		agent: string,
		provider: string | null,
		model: string,
		input: number,
		output: number,
	): ModelPrice => ({ agent, provider, model, perMillion: { input, output } });

	beforeEach(async () => {
		await prisma.setting.deleteMany({ where: { key: "USAGE_PRICES" } });
	});

	async function turn(
		harness: string,
		usage: Record<string, unknown>,
		before: Record<string, unknown>[] = [],
	) {
		const thread = await prisma.investigation.create({
			data: { status: "completed", kind: "chat", harness },
		});
		let seq = 0;
		for (const e of [...before, { kind: "turn_usage", usage }])
			await prisma.investigationEvent.create({
				data: {
					investigationId: thread.id,
					branchId: "main",
					seq: ++seq,
					createdAt: new Date(NOW.getTime() - 60_000 + seq),
					event: JSON.stringify(e),
				},
			});
	}

	const summary = () =>
		new UsageService(prisma).summary({ range: "24h" }, NOW);

	it("prices an OpenCode turn exactly, and a provider-specific price beats Any route", async () => {
		await new UsageService(prisma).setPrices({
			prices: [
				price("opencode", null, "google/gemini-2.5-flash", 1, 1),
				price("opencode", "google", "google/gemini-2.5-flash", 0.3, 2.5),
			],
		});
		await turn("opencode", {
			model: "google/gemini-2.5-flash",
			inputTokens: 1_000_000,
			outputTokens: 200_000,
			thoughtTokens: 100_000,
		});
		const s = await summary();
		expect(s.totals.cost).toEqual({
			amount: null,
			currency: "USD",
			unpricedTurns: 1,
			estimate: 1.05,
			estimatedTurns: 1,
		});
		expect(s.models[0]?.cost.estimate).toBe(1.05);
	});

	it("gives none for a price naming another provider", async () => {
		await new UsageService(prisma).setPrices({
			prices: [price("opencode", "openrouter", "google/gemini-2.5-flash", 1, 1)],
		});
		await turn("opencode", {
			model: "google/gemini-2.5-flash",
			inputTokens: 1_000,
		});
		const s = await summary();
		expect([s.totals.cost.estimate, s.totals.cost.estimatedTurns]).toEqual([
			null,
			0,
		]);
	});

	it("gives a Claude turn, whose provider is unknown, the Any route price and never the specific one", async () => {
		await new UsageService(prisma).setPrices({
			prices: [
				price("claude-code", "anthropic", "claude-opus-5-5", 100, 100),
				price("claude-code", null, "claude-opus-5-5", 5, 25),
			],
		});
		await turn("claude-code", {
			model: "claude-opus-5-5",
			inputTokens: 2_000_000,
			outputTokens: 1_000_000,
		});
		expect((await summary()).totals.cost.estimate).toBe(35);
	});

	it("prices a turn that named no model by the model its session had selected", async () => {
		await new UsageService(prisma).setPrices({
			prices: [price("claude-code", null, "claude-sonnet-5-5", 3, 15)],
		});
		await turn("claude-code", { inputTokens: 1_000_000 }, [
			{
				kind: "session_opened",
				how: "new",
				cause: "first",
				harness: "claude-code",
				model: "claude-opus-5-5",
				carrier: "event",
			},
			{
				kind: "session_config",
				option: "model",
				value: "claude-sonnet-5-5",
				accepted: true,
			},
		]);
		expect((await summary()).totals.cost.estimate).toBe(3);
	});

	const opened = (model: string | null) => ({
		kind: "session_opened",
		how: "new",
		cause: "first",
		harness: "claude-code",
		model,
		carrier: "event",
	});
	const modelRows = async () =>
		(await summary()).models.map((m) => [m.model, m.cost.estimate]);

	it("puts a turn that named no model on the row of the model it was priced by", async () => {
		await new UsageService(prisma).setPrices({
			prices: [price("claude-code", null, "claude-sonnet-5-5", 3, 15)],
		});
		await turn("claude-code", { inputTokens: 1_000_000 }, [
			opened("claude-sonnet-5-5"),
		]);
		// The thread has since moved to another model.
		await prisma.investigation.updateMany({
			data: { model: "claude-opus-5-5" },
		});
		expect(await modelRows()).toEqual([["claude-sonnet-5-5", 3]]);
	});

	it("puts a turn on the agent whose price it took, after the thread moved to another agent", async () => {
		await new UsageService(prisma).setPrices({
			prices: [price("claude-code", null, "claude-sonnet-5-5", 3, 15)],
		});
		await turn("codex", { inputTokens: 1_000_000 }, [
			opened("claude-sonnet-5-5"),
		]);
		expect(
			(await summary()).models.map((m) => [m.agent, m.model, m.cost.estimate]),
		).toEqual([["claude-code", "claude-sonnet-5-5", 3]]);
	});

	it("prices no turn by a model that an opening with none replaced", async () => {
		await new UsageService(prisma).setPrices({
			prices: [price("claude-code", null, "claude-sonnet-5-5", 3, 15)],
		});
		await turn("claude-code", { inputTokens: 1_000_000 }, [
			opened("claude-sonnet-5-5"),
			opened(null),
		]);
		expect(await modelRows()).toEqual([["unknown", null]]);
	});

	it("gives none to a turn of several models", async () => {
		await new UsageService(prisma).setPrices({
			prices: [price("claude-code", null, "mixed", 1, 1)],
		});
		await turn("claude-code", {
			inputTokens: 1_000_000,
			identity: {
				agent: { value: "claude-code", source: "reported" },
				provider: { value: null, source: "unknown" },
				maker: { value: null, source: "unknown" },
				model: { value: "mixed", source: "reported" },
			},
		});
		expect((await summary()).totals.cost.estimate).toBeNull();
	});

	it("never replaces a reported cost", async () => {
		await new UsageService(prisma).setPrices({
			prices: [price("claude-code", null, "claude-opus-5-5", 5, 25)],
		});
		await turn("claude-code", {
			model: "claude-opus-5-5",
			inputTokens: 1_000_000,
			cost: { amount: 1.25, currency: "USD" },
		});
		expect((await summary()).totals.cost).toEqual({
			amount: 1.25,
			currency: "USD",
			unpricedTurns: 0,
			estimate: null,
			estimatedTurns: 0,
		});
	});
});
