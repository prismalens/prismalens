// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The What-changed writer and read (#811) over real git repositories, the local git
 * HTTP fixture and a temp SQLite database.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-changes-"));
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pl-changes-home-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	process.env.HOME = home;
	return { root, home };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { CredentialsService } = await import(
	"../integrations/crypto/credentials.service.js"
);
const { IntegrationsService } = await import(
	"../integrations/integrations.service.js"
);
const { GitCredentialService } = await import(
	"../integrations/git-credential.service.js"
);
const { RepoSourceService } = await import(
	"../../core/harness/repo-source.service.js"
);
const { GitFailure } = await import("../../core/harness/git-failure.js");
const { ChangeEventsService, LOOKBACK_MS, problemOf } = await import(
	"./change-events.service.js"
);
const { startGitHttpServer } = await import(
	"../../core/harness/__fixtures__/git-http-server.js"
);
import type { GitHttpServer } from "../../core/harness/__fixtures__/git-http-server.js";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function git(args: string[], cwd: string, at?: Date): string {
	const date = at?.toISOString();
	return execFileSync("git", args, {
		cwd,
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0",
			GIT_AUTHOR_NAME: "Dev",
			GIT_AUTHOR_EMAIL: "dev@test.local",
			GIT_COMMITTER_NAME: "Dev",
			GIT_COMMITTER_EMAIL: "dev@test.local",
			...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
		},
	})
		.toString()
		.trim();
}

function commit(dir: string, file: string, subject: string, at: Date): string {
	mkdirSync(dirname(join(dir, file)), { recursive: true });
	writeFileSync(join(dir, file), `${subject}\n`);
	git(["add", "--", file], dir);
	git(["commit", "-q", "-m", subject], dir, at);
	return git(["rev-parse", "HEAD"], dir);
}

describe("ChangeEventsService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let service: InstanceType<typeof ChangeEventsService>;
	let server: GitHttpServer;
	const start = new Date(Date.now() - HOUR);
	let shas: Record<string, string>;
	let folder: string;

	async function incidentFor(
		links: Array<{ url: string; sourceKind: "folder" | "url"; subPath?: string }>,
		triggeredAt = start,
	): Promise<string> {
		const svc = await prisma.service.create({
			data: { name: `svc-${Math.random().toString(36).slice(2, 8)}` },
		});
		for (const l of links) {
			const repo = await prisma.repository.create({
				data: {
					sourceKind: l.sourceKind,
					fullName: l.url.split("/").slice(-2).join("/"),
					url: l.url,
				},
			});
			await prisma.serviceRepository.create({
				data: { serviceId: svc.id, repositoryId: repo.id, subPath: l.subPath },
			});
		}
		const last = await prisma.incident.findFirst({ orderBy: { number: "desc" } });
		const incident = await prisma.incident.create({
			data: {
				number: (last?.number ?? 0) + 1,
				title: "p99 over threshold",
				serviceId: svc.id,
				triggeredAt,
			},
		});
		return incident.id;
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import(
			"@prismalens/database/migrator"
		);
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		const config = {
			get: (key: string) =>
				key === "PRISMALENS_ENCRYPTION_KEY" ? "ab".repeat(32) : undefined,
		};
		const credentials = new CredentialsService(
			config as unknown as ConstructorParameters<typeof CredentialsService>[0],
		);
		const integrations = new IntegrationsService(prisma, credentials, {
			capture: vi.fn(async () => {}),
		} as unknown as ConstructorParameters<typeof IntegrationsService>[2]);
		integrations.onModuleInit();
		service = new ChangeEventsService(
			prisma,
			new RepoSourceService(),
			new GitCredentialService(prisma, credentials, integrations),
		);
		server = await startGitHttpServer({ tls: false });

		folder = mkdtempSync(join(env.root, "repo-"));
		git(["init", "-q", "-b", "main"], folder);
		const at = (ms: number) => new Date(start.getTime() + ms);
		shas = {
			old: commit(folder, "a.txt", "old change", at(-LOOKBACK_MS - DAY)),
			release: commit(folder, "b.txt", "cut release", at(-3 * DAY)),
		};
		git(["tag", "v1.2"], folder);
		shas.plain = commit(folder, "api/pool.py", "tune pool size", at(-2 * DAY));
		git(["checkout", "-q", "-b", "fix"], folder);
		commit(folder, "api/routes/books.py", "wip", at(-DAY - HOUR));
		git(["checkout", "-q", "main"], folder);
		git(
			[
				"merge",
				"-q",
				"--no-ff",
				"-m",
				"Merge pull request #12 from dev/fix",
				"-m",
				"Load notes in one query",
				"fix",
			],
			folder,
			at(-DAY),
		);
		shas.merge = git(["rev-parse", "HEAD"], folder);
		shas.readme = commit(folder, "README.md", "bump readme (#13)", at(-30 * 60_000));
		shas.hotfix = commit(folder, "web/app.js", "hotfix", at(30 * 60_000));
	});

	afterAll(async () => {
		await server?.close();
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
		rmSync(env.home, { recursive: true, force: true });
	});

	it("reads a folder's first-parent history in the window, newest first, with the newest merge before the start as the deploy", async () => {
		const id = await incidentFor([{ url: folder, sourceKind: "folder" }]);
		const res = await service.forIncident(id, { limit: 3 });

		expect(res?.state).toBe("ok");
		expect(res?.refreshing).toBe(false);
		expect(res?.total).toBe(5);
		expect(res?.timeline.map((c) => c.sha)).toEqual([
			shas.hotfix,
			shas.readme,
			shas.merge,
		]);
		expect(res?.deploy?.sha).toBe(shas.readme);
		expect(res?.deploy?.kind).toBe("merge");
		expect(res?.deploy?.pr).toBe(13);

		const merge = res?.timeline[2];
		expect(merge?.kind).toBe("merge");
		expect(merge?.title).toBe("Load notes in one query");
		expect(merge?.pr).toBe(12);
		expect(merge?.files).toEqual({ count: 1, paths: ["api/routes/books.py"] });
		expect(merge?.url).toBeNull();
		expect(res?.sources[0]?.credential?.label).toBe("folder");

		const all = await service.forIncident(id, { limit: 50 });
		const release = all?.timeline.find((c) => c.sha === shas.release);
		expect(release?.kind).toBe("release");
		expect(release?.tag).toBe("v1.2");
		expect(all?.timeline.map((c) => c.sha)).not.toContain(shas.old);
	});

	it("picks the newest deploy kind before the start over a newer plain commit", async () => {
		const id = await incidentFor(
			[{ url: folder, sourceKind: "folder" }],
			new Date(start.getTime() - 12 * HOUR),
		);
		const res = await service.forIncident(id);
		expect(res?.deploy?.sha).toBe(shas.merge);
		expect(res?.timeline).toHaveLength(5);
	});

	it("never doubles a commit when the same repository is read again", async () => {
		const id = await incidentFor([{ url: folder, sourceKind: "folder" }]);
		await service.forIncident(id);
		const svcId = (await prisma.incident.findUnique({ where: { id } }))?.serviceId;
		const before = await prisma.changeEvent.count({ where: { serviceId: svcId } });
		await service.forIncident(id, { refresh: true });
		await service.forIncident(id, { refresh: true });
		const after = await prisma.changeEvent.count({ where: { serviceId: svcId } });
		expect(before).toBe(5);
		expect(after).toBe(before);
	});

	it("keeps one row per service when two services link the same repository, and filters a monorepo sub-path", async () => {
		const a = await incidentFor([{ url: folder, sourceKind: "folder", subPath: "api" }]);
		const res = await service.forIncident(a, { limit: 10 });
		expect(res?.timeline.map((c) => c.sha)).toEqual([shas.merge, shas.plain]);
		const rows = await prisma.changeEvent.count({
			where: { metadata: { contains: shas.merge } },
		});
		expect(rows).toBeGreaterThan(1);
	});

	it("reads a URL through its mirror with the resolver's credential", async () => {
		const url = server.addRepo("public-api", { kind: "anonymous" });
		const head = server.headOf("public-api");
		const id = await incidentFor([{ url, sourceKind: "url" }], new Date(Date.now() + HOUR));
		const res = await service.forIncident(id);
		expect(res?.state).toBe("ok");
		expect(res?.sources[0]?.credential?.label).toBe("public");
		expect(res?.deploy?.sha).toBe(head);
		expect(res?.deploy?.kind).toBe("commit");
	});

	it("answers a repository with no credential as a failed source the UI can act on, not a throw", async () => {
		const url = server.addRepo("private-api", { kind: "reject-401" });
		const id = await incidentFor([{ url, sourceKind: "url" }]);
		const res = await service.forIncident(id);
		expect(res?.state).toBe("failed");
		expect(res?.timeline).toEqual([]);
		expect(res?.deploy).toBeNull();
		expect(res?.sources[0]).toMatchObject({
			status: "failed",
			problem: { code: "no-credential", action: "add-credential" },
		});
	});

	it("reports partial when one of two repositories fails", async () => {
		const url = server.addRepo("private-web", { kind: "reject-401" });
		const id = await incidentFor([
			{ url: folder, sourceKind: "folder" },
			{ url, sourceKind: "url" },
		]);
		const res = await service.forIncident(id);
		expect(res?.state).toBe("partial");
		expect(res?.total).toBe(5);
	});

	it("says no-repos when no service of the incident links a repository", async () => {
		const id = await incidentFor([]);
		const res = await service.forIncident(id);
		expect(res?.state).toBe("no-repos");
		expect(res?.sources).toEqual([]);
		expect(res?.total).toBe(0);
	});

	it("shows rows another source wrote, with their own kind and version", async () => {
		const id = await incidentFor([]);
		const svcId = (await prisma.incident.findUnique({ where: { id } }))?.serviceId;
		await prisma.changeEvent.createMany({
			data: [
				{
					type: "deployment",
					source: "manual",
					serviceId: svcId,
					timestamp: new Date(start.getTime() - HOUR),
					description: "Deploy v9",
					metadata: JSON.stringify({ version: "v9" }),
				},
				{
					type: "unknown",
					source: "manual",
					serviceId: svcId,
					timestamp: new Date(start.getTime() - 2 * HOUR),
					metadata: "not json",
				},
			],
		});
		const res = await service.forIncident(id);
		expect(res?.deploy).toMatchObject({
			kind: "deployment",
			tag: "v9",
			title: "Deploy v9",
			files: null,
			source: "manual",
		});
		expect(res?.timeline[1]).toMatchObject({ kind: "commit", title: "unknown", sha: null });
	});

	it("answers a folder that is not a git repository as an error source", async () => {
		const id = await incidentFor([
			{ url: mkdtempSync(join(env.root, "plain-")), sourceKind: "folder" },
		]);
		const res = await service.forIncident(id);
		expect(res?.state).toBe("failed");
		expect(res?.sources[0]?.problem?.code).toBe("error");
	});

	it("maps git's failures to what the user can do", () => {
		expect(
			problemOf(new GitFailure("other", "The requested URL returned error: 429")),
		).toEqual({
			code: "rate-limited",
			message: "The requested URL returned error: 429",
			action: null,
		});
		expect(
			problemOf(new GitFailure("ambiguous", "2 saved tokens", "pick-credential")),
		).toMatchObject({ code: "pick-credential", action: "pick-credential" });
		expect(problemOf("boom")).toMatchObject({ code: "error", message: "boom" });
	});

	it("returns null for an unknown incident", async () => {
		expect(
			await service.forIncident("00000000-0000-4000-8000-000000000000"),
		).toBeNull();
	});
});
