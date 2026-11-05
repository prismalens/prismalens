// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadsController } from "./threads.controller.js";
import { ThreadsService, threadView } from "./threads.service.js";

const REPO = "11111111-1111-4111-8111-111111111111";
const SERVICE = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const TX = {
	tx: true,
	repository: {
		findUnique: vi.fn(async () => ({ plain: false, url: "/code/shop" })),
	},
	investigation: {
		findMany: vi.fn(async (): Promise<unknown[]> => []),
	},
};

const row = (over: Record<string, unknown> = {}) => ({
	id: RUN,
	incidentId: null,
	serviceId: null,
	scheduleId: null,
	repositoryId: REPO,
	status: "running",
	kind: "chat",
	title: "Rename the retry helper",
	accessLevel: "auto-edits",
	harness: "claude-code",
	model: null,
	effort: null,
	startedAt: null,
	completedAt: null,
	error: null,
	awaitingApprovalAt: null,
	origin: "local",
	schemaVersion: 1,
	createdAt: new Date("2026-11-03T00:00:00Z"),
	updatedAt: new Date("2026-11-03T00:00:00Z"),
	...over,
});

describe("ThreadsService (#1020)", () => {
	const thread = {
		subject: "project" as const,
		repositoryId: REPO,
		serviceId: null,
		name: "shop",
		repos: [],
	};
	let prisma: {
		repository: { findUnique: ReturnType<typeof vi.fn> };
		service: { findUnique: ReturnType<typeof vi.fn> };
		investigation: {
			findMany: ReturnType<typeof vi.fn>;
			findUnique: ReturnType<typeof vi.fn>;
			updateMany: ReturnType<typeof vi.fn>;
		};
	};
	let investigations: { startOrGet: ReturnType<typeof vi.fn> };
	let dispatch: {
		threadRunOf: ReturnType<typeof vi.fn>;
		addInvestigationJob: ReturnType<typeof vi.fn>;
	};
	let harness: {
		resolveSelection: ReturnType<typeof vi.fn>;
		ensureReady: ReturnType<typeof vi.fn>;
	};
	let attachments: {
		checkDraft: ReturnType<typeof vi.fn>;
		claimDraft: ReturnType<typeof vi.fn>;
	};
	let integrations: { getIntegrationsForService: ReturnType<typeof vi.fn> };
	const service = () =>
		new ThreadsService(
			prisma as never,
			investigations as never,
			dispatch as never,
			harness as never,
			attachments as never,
			integrations as never,
		);

	beforeEach(() => {
		prisma = {
			repository: { findUnique: vi.fn(async () => ({ id: REPO })) },
			service: { findUnique: vi.fn(async () => ({ id: SERVICE })) },
			investigation: {
				findMany: vi.fn(async () => [row()]),
				findUnique: vi.fn(async () => ({ updatedAt: row().updatedAt })),
				updateMany: vi.fn(async () => ({ count: 1 })),
			},
		};
		investigations = {
			startOrGet: vi.fn(
				async (dto: { onCreate?: (tx: unknown, id: string) => Promise<void> }) => {
					await dto.onCreate?.(TX, RUN);
					return { investigation: { id: RUN }, created: true };
				},
			),
		};
		dispatch = {
			threadRunOf: vi.fn(async () => thread),
			addInvestigationJob: vi.fn(async () => "job-1"),
		};
		harness = {
			resolveSelection: vi.fn(async () => ({
				runnable: true,
				harness: "claude-code",
			})),
			ensureReady: vi.fn(async () => ({ ready: true })),
		};
		attachments = {
			checkDraft: vi.fn(async () => {}),
			claimDraft: vi.fn(async () => [
				{ id: "f1", name: "a.txt", mimeType: "text/plain", size: 1, path: "/x" },
			]),
		};
		integrations = {
			getIntegrationsForService: vi.fn(async () => [{ connectionId: "c1" }]),
		};
	});

	it("starts a project chat with no incident, its own run, the project's code and the draft's files", async () => {
		const out = await service().start({
			subject: { kind: "project", repositoryId: REPO },
			text: "Rename the retry helper",
			accessLevel: "auto-edits",
			harness: "claude-code",
			draftKey: DRAFT,
			attachments: ["f1"],
		});
		expect(out).toEqual({ investigationId: RUN, jobId: "job-1", queued: true });
		expect(investigations.startOrGet).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: null,
				repositoryId: REPO,
				kind: "chat",
				title: "Rename the retry helper",
				accessLevel: "auto-edits",
			}),
		);
		expect(attachments.checkDraft).toHaveBeenCalledWith(DRAFT, ["f1"]);
		expect(attachments.claimDraft).toHaveBeenCalledWith(DRAFT, ["f1"], RUN, TX);
		const job = dispatch.addInvestigationJob.mock.calls[0]?.[0];
		expect(job).toMatchObject({
			incidentId: null,
			investigationId: RUN,
			thread,
			kind: "chat",
			harness: "claude-code",
			chat: { text: "Rename the retry helper", attachments: [{ id: "f1" }] },
		});
		expect(job.alerts).toBeUndefined();
		expect(integrations.getIntegrationsForService).not.toHaveBeenCalled();
	});

	it("gives a service chat the service's connections, and a no-subject chat nothing", async () => {
		await service().start({
			subject: { kind: "service", serviceId: SERVICE },
			text: "Why is p99 up?",
		});
		expect(investigations.startOrGet).toHaveBeenCalledWith(
			expect.objectContaining({ serviceId: SERVICE }),
		);
		expect(dispatch.addInvestigationJob.mock.calls[0]?.[0]).toMatchObject({
			connectionIds: ["c1"],
		});
		await service().start({ subject: { kind: "none" }, text: "hello" });
		expect(dispatch.threadRunOf).toHaveBeenLastCalledWith({
			repositoryId: null,
			serviceId: null,
			helperPlace: null,
		});
		expect(
			dispatch.addInvestigationJob.mock.calls[1]?.[0].connectionIds,
		).toBeUndefined();
	});

	it("refuses a second live thread in a plain folder, inside the admitting transaction (#1020)", async () => {
		TX.repository.findUnique.mockResolvedValueOnce({ plain: true, url: "/code/notes" });
		TX.investigation.findMany.mockResolvedValueOnce([
			{ repository: { url: "/code/notes" } },
		]);
		await expect(
			service().start({
				subject: { kind: "project", repositoryId: REPO },
				text: "Tidy the notes",
				harness: "claude-code",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(TX.investigation.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: { not: RUN } }),
			}),
		);
		expect(dispatch.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("keeps a helper's page on a no-subject run and its job, and drops it on any other subject", async () => {
		await service().start({
			subject: { kind: "none" },
			text: "hi",
			place: "alerts",
		});
		expect(investigations.startOrGet).toHaveBeenLastCalledWith(
			expect.objectContaining({ helperPlace: "alerts" }),
		);
		expect(dispatch.threadRunOf).toHaveBeenLastCalledWith({
			repositoryId: null,
			serviceId: null,
			helperPlace: "alerts",
		});
		await service().start({
			subject: { kind: "project", repositoryId: REPO },
			text: "hi",
			place: "alerts",
		});
		expect(
			investigations.startOrGet.mock.lastCall?.[0].helperPlace,
		).toBeUndefined();
		expect(dispatch.threadRunOf).toHaveBeenLastCalledWith({
			repositoryId: REPO,
			serviceId: null,
			helperPlace: null,
		});
	});

	it("refuses before writing anything: a missing project or service, files with no draft, an agent that cannot run", async () => {
		prisma.repository.findUnique.mockResolvedValueOnce(null);
		await expect(
			service().start({
				subject: { kind: "project", repositoryId: REPO },
				text: "x",
			}),
		).rejects.toThrow(/Project not found/);
		prisma.service.findUnique.mockResolvedValueOnce(null);
		await expect(
			service().start({
				subject: { kind: "service", serviceId: SERVICE },
				text: "x",
			}),
		).rejects.toThrow(/Service not found/);
		await expect(
			service().start({
				subject: { kind: "none" },
				text: "x",
				attachments: ["f1"],
			}),
		).rejects.toThrow(/draft/);
		harness.resolveSelection.mockResolvedValueOnce({
			runnable: false,
			reason: "No agent is installed",
			failure: "none-installed",
		});
		await expect(
			service().start({ subject: { kind: "none" }, text: "x" }),
		).rejects.toThrow(/No agent is installed/);
		harness.ensureReady.mockResolvedValueOnce({
			ready: false,
			reason: "Sign in first",
		});
		await expect(
			service().start({ subject: { kind: "none" }, text: "x" }),
		).rejects.toThrow(/Sign in first/);
		expect(investigations.startOrGet).not.toHaveBeenCalled();
	});

	it("claims the draft inside the run's create, so a lost race leaves no run and no job", async () => {
		attachments.claimDraft.mockRejectedValueOnce(new Error("not on this thread"));
		await expect(
			service().start({
				subject: { kind: "none" },
				text: "x",
				draftKey: DRAFT,
				attachments: ["f1"],
			}),
		).rejects.toThrow(/not on this thread/);
		expect(dispatch.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("says queued is false when the job could not be stored", async () => {
		dispatch.addInvestigationJob.mockResolvedValueOnce(null);
		const out = await service().start({ subject: { kind: "none" }, text: "x" });
		expect(out.queued).toBe(false);
	});

	it("visit retries a lost race, then refuses with CONFLICT rather than report an unwritten visit", async () => {
		prisma.investigation.updateMany
			.mockResolvedValueOnce({ count: 0 })
			.mockResolvedValueOnce({ count: 1 });
		await expect(service().visit(RUN)).resolves.toHaveProperty("lastVisitedAt");
		expect(prisma.investigation.updateMany).toHaveBeenCalledTimes(2);

		prisma.investigation.updateMany.mockReset();
		prisma.investigation.updateMany.mockResolvedValue({ count: 0 });
		await expect(service().visit(RUN)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(prisma.investigation.updateMany).toHaveBeenCalledTimes(3);
	});

	it("lists a project's or a service's own threads, never its incidents' or schedules'", async () => {
		const rows = await service().list({ repositoryId: REPO, limit: 10 });
		expect(prisma.investigation.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { incidentId: null, scheduleId: null, repositoryId: REPO },
				take: 10,
			}),
		);
		expect(rows[0]).toMatchObject({
			id: RUN,
			subject: "project",
			kind: "chat",
			title: "Rename the retry helper",
		});
		await service().list({ serviceId: SERVICE, limit: 5 });
		expect(prisma.investigation.findMany).toHaveBeenLastCalledWith(
			expect.objectContaining({
				where: {
					incidentId: null,
					scheduleId: null,
					serviceId: SERVICE,
					repositoryId: null,
				},
			}),
		);
		await expect(service().list({ limit: 5 })).resolves.toEqual([]);
	});

	it("settles every thread of an incident without moving their updatedAt", async () => {
		const updatedAt = new Date("2026-11-03T00:00:00Z");
		const findUnique = vi.fn(async (args: { select: object }) =>
			"updatedAt" in args.select ? { updatedAt } : { incidentId: "inc-1" },
		);
		const updateMany = vi.fn(async () => ({ count: 1 }));
		Object.assign(prisma.investigation, {
			findUnique,
			updateMany,
			findMany: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
		});

		await expect(service().settle("a", true)).resolves.toMatchObject({
			ids: ["a", "b"],
		});

		expect(updateMany).toHaveBeenCalledTimes(2);
		for (const [arg] of updateMany.mock.calls as unknown as [
			{ where: object; data: { settledAt: Date; updatedAt: Date } },
		][]) {
			expect(arg.where).toMatchObject({ updatedAt });
			expect(arg.data.updatedAt).toBe(updatedAt);
			expect(arg.data.settledAt).toBeInstanceOf(Date);
		}
	});

	it("shows a row with an unknown level as none, and an investigation kind as such", () => {
		const view = threadView(
			row({
				accessLevel: "bogus",
				kind: "investigation",
				startedAt: new Date("2026-11-03T00:01:00Z"),
				completedAt: new Date("2026-11-03T00:02:00Z"),
				awaitingApprovalAt: new Date("2026-11-03T00:01:30Z"),
			}) as never,
		);
		expect(view.accessLevel).toBeNull();
		expect(view.kind).toBe("investigation");
		expect(view.completedAt).toBe("2026-11-03T00:02:00.000Z");
		expect(view.awaitingApprovalAt).toBe("2026-11-03T00:01:30.000Z");
	});
});

describe("ThreadsController (#1020)", () => {
	it("routes each call to the thread service or the attachment store", async () => {
		const threads = {
			start: vi.fn(async () => ({ investigationId: RUN })),
			list: vi.fn(async () => []),
		};
		const attachments = {
			uploadDraft: vi.fn(async () => ({ id: "a" })),
			uploadForRun: vi.fn(async () => ({ id: "b" })),
			readForRun: vi.fn(async () => new File(["x"], "x.txt")),
		};
		const routes = new ThreadsController(
			threads as never,
			attachments as never,
		).routes();
		type Callable = { "~orpc": { handler: (o: { input: unknown }) => unknown } };
		const call = (r: unknown, input: unknown) =>
			(r as Callable)["~orpc"].handler({ input });
		const file = new File(["x"], "x.txt");
		await call(routes.start, { subject: { kind: "none" }, text: "x" });
		expect(threads.start).toHaveBeenCalled();
		await expect(call(routes.list, { repositoryId: REPO, limit: 5 })).resolves.toEqual({
			data: [],
		});
		await call(routes.uploadDraftAttachment, { draftKey: DRAFT, file });
		expect(attachments.uploadDraft).toHaveBeenCalledWith(DRAFT, file);
		await call(routes.uploadAttachment, { id: RUN, file });
		expect(attachments.uploadForRun).toHaveBeenCalledWith(RUN, file);
		await call(routes.attachment, { id: RUN, attachmentId: "a" });
		expect(attachments.readForRun).toHaveBeenCalledWith(RUN, "a");
	});
});

describe("ThreadsService.settle (#1020)", () => {
	const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
	const stamp = new Date("2026-11-03T00:00:00Z");

	/** Two threads of one incident; B's guarded write always loses, like a row that keeps changing. */
	function build() {
		const settledAt = new Map<string, Date | null>([
			[A, null],
			[B, null],
		]);
		const other = new Map<string, string>();
		const db = {
			investigation: {
				findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
					settledAt.has(where.id)
						? {
								incidentId: "inc",
								updatedAt: stamp,
								settledAt: settledAt.get(where.id),
							}
						: null,
				),
				findMany: vi.fn(async () =>
					[...settledAt].map(([id, at]) => ({ id, settledAt: at })),
				),
				updateMany: vi.fn(
					async ({
						where,
						data,
					}: {
						where: { id: string };
						data: { settledAt?: Date | null };
					}) => {
						if (where.id === B) return { count: 0 };
						other.set("write", "kept");
						settledAt.set(where.id, data.settledAt ?? null);
						return { count: 1 };
					},
				),
			},
			$transaction: vi.fn(),
		};
		return {
			settledAt,
			other,
			db,
			svc: new ThreadsService(
				db as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
			),
		};
	}

	it("writes the earlier threads back when a later one keeps conflicting, without a transaction", async () => {
		const { svc, settledAt, other, db } = build();
		await expect(svc.settle(A, true)).rejects.toMatchObject({ code: "CONFLICT" });
		expect(settledAt.get(A)).toBeNull();
		expect(other.get("write")).toBe("kept");
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("leaves a thread another request settled since, when putting the earlier ones back", async () => {
		const { svc, settledAt, db } = build();
		const newer = new Date("2026-11-04T00:00:00Z");
		const real = db.investigation.updateMany.getMockImplementation() as (
			args: { where: { id: string }; data: { settledAt?: Date | null } },
		) => Promise<{ count: number }>;
		db.investigation.updateMany.mockImplementation(async (args) => {
			if (args.where.id === B) settledAt.set(A, newer);
			return real(args);
		});
		await expect(svc.settle(A, true)).rejects.toMatchObject({ code: "CONFLICT" });
		expect(settledAt.get(A)).toEqual(newer);
	});

	it("writes back an undo that restores several threads when one conflicts", async () => {
		const { svc, settledAt } = build();
		settledAt.set(A, stamp);
		await expect(
			svc.settle(A, false, [
				{ id: A, settledAt: null },
				{ id: B, settledAt: null },
			]),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(settledAt.get(A)).toEqual(stamp);
	});
});
