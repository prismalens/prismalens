// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the one-ACP-run-per-investigation job (0005 §2, ADR 0002/0004):
 * `resolveWorkspace` (the per-investigation clone under the app-data dir — ADR 0004 §2,
 * no user checkout as cwd), and `runInvestigationJob`'s schema-validation/failure-persistence paths.
 * No network, no LLM, no real harness — `@prismalens/engine` is mocked wherever a test
 * needs `conductRun` to run at all.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { AccessLevel } from "@prismalens/config/harness";
import { type CanonicalEvent, CanonicalEventSchema, type InvestigationJobData, type RunWorkspace } from "@prismalens/contracts";
import { type conductRun, withPreRunCoverage } from "@prismalens/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import type { Snapshot } from "../../core/harness/repo-source.service.js";
import type { IncidentRepo, RepoRef, RunPorts } from "./run-ports.js";

const mocks = vi.hoisted(() => ({ conductRun: vi.fn() }));

vi.mock("@prismalens/engine", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@prismalens/engine")>();
	return {
		...actual,
		conductRun: mocks.conductRun,
	};
});

vi.mock("@prismalens/logger", () => ({
	Logger: vi.fn(function MockLogger() {
		return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
	}),
	enrichContext: vi.fn(),
}));

vi.mock("@prismalens/logger/standalone", () => ({
	runWithWideEvent: (_name: string, fn: () => unknown) => fn(),
}));


const PUBLIC_CREDENTIAL = { source: "none" as const, label: "public", via: "none" };

/** A `snapshotWith` double from what the clone returns; the credential is always public, and a clone into `dest` leaves it on disk as the real one does. */
function cloneAs(
	fn: (ref: RepoRef, dest: string, signal?: AbortSignal, at?: string) => Promise<Snapshot>,
) {
	return vi.fn(async (ref: RepoRef, dest: string, signal?: AbortSignal, at?: string) => {
		const snap = await fn(ref, dest, signal, at);
		if (snap.path === dest) mkdirSync(dest, { recursive: true });
		return { snap, credential: PUBLIC_CREDENTIAL };
	});
}

const {
	resolveWorkspace,
	rebuildWorkspace,
	runDirFor,
	default: runInvestigationJob,
} = await import("./investigation-run.js");

/** A `RunPorts` double covering exactly what the job makes. */
function fakePorts(overrides: Partial<RunPorts> = {}): RunPorts {
	return {
		findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "running", harness: null, model: null, acpSessionId: null, workspace: null })),
		updateStatus: vi.fn(async () => true),
		appendEvents: vi.fn(async (_id: string, _events: CanonicalEvent[]) => {}),
		clearEvents: vi.fn(async () => {}),
		followUpStatus: vi.fn(async () => {}),
		initLiveTurn: vi.fn(async () => {}),
		settleFollowUp: vi.fn(async () => true),
		lastEventSeq: vi.fn(async () => -1),
		events: vi.fn(async () => []),
		recordHandoff: vi.fn(async () => {}),
		recordSession: vi.fn(async () => {}),
		recordUsage: vi.fn(async () => {}),
		markAwaitingApproval: vi.fn(async () => {}),
		newerRun: vi.fn(async () => null),
		writeResult: vi.fn(async () => true),
		createTimelineEntry: vi.fn(async (_dto: CreateTimelineEntryDto) => {}),
		resolveHarness: vi.fn(async () => ({
			selection: { runnable: true as const, harness: "opencode" as const, auto: true },
		})),
		getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })),
		incidentRepos: vi.fn(async () => []),
		snapshotWith: cloneAs(async () => ({ path: "/app-data/repos/clone", head: "abc123def456", branch: "main" as const })),
		resolveConnectors: vi.fn(async () => []),
		contextPack: vi.fn(async () => null),
		...overrides,
	};
}

/**
 * ADR 0004 §2: the harness runs in a fresh snapshot of prismalens's own repo,
 * never the user's checkout. No linked repo means an honest UNMAPPED run in an
 * empty scratch dir; a linked repo means `ports.snapshotWith` is called with the
 * repo's sourceKind/url/connectionId/defaultBranch and a dest under the run dir, and the
 * cwd is the snapshot path plus the repo's subPath.
 */
describe("resolveWorkspace (per-investigation harness cwd)", () => {
	function minimalData(overrides: Partial<InvestigationJobData> = {}): InvestigationJobData {
		return { investigationId: "inv-1", incidentId: "inc-1", ...overrides };
	}

	it("no linked repo: an UNMAPPED scratch dir under the app-data dir, and it exists on disk", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const ports = fakePorts({ incidentRepos: vi.fn(async () => []) });
			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.layout).toBe("unmapped");
			expect(ws.cwd).toBe(join(tmp, "runs", "inv-1", "unmapped"));
			expect(existsSync(ws.cwd)).toBe(true);
			expect(ws.note).toContain("no repository linked");
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("a linked repo: snapshotWith gets sourceKind/url/connectionId/defaultBranch and a dest under the run dir, cwd is the snapshot path plus subPath, and the note names the commit", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const snapshot = cloneAs(async (_src: unknown, dest: string) => {
				mkdirSync(join(dest, "services", "api"), { recursive: true });
				return { path: dest, head: "abc123def456789", branch: "main" as const };
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					{
						sourceKind: "url" as const,
						url: "https://github.com/acme/api-gateway",
						defaultBranch: "main",
						subPath: "services/api",
						connectionId: "conn-1",
						serviceName: "checkout",
					},
				]),
				snapshotWith: snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(snapshot).toHaveBeenCalledWith(
				{
					sourceKind: "url",
					url: "https://github.com/acme/api-gateway",
					connectionId: "conn-1",
					defaultBranch: "main",
				},
				join(tmp, "runs", "inv-1", "repo"),
				expect.any(AbortSignal),
			);
			expect(ws.layout).toBe("single");
			expect(ws.cwd).toBe(join(tmp, "runs", "inv-1", "repo", "services", "api"));
			expect(ws.note).toContain("https://github.com/acme/api-gateway");
			expect(ws.note).toContain("abc123def456");
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("a linked repo with no subPath: cwd is the snapshot path itself", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null, serviceName: "checkout" },
				]),
				snapshotWith: cloneAs(async (_src: unknown, dest: string) => ({ path: dest, head: "abc123def456789", branch: "main" as const })),
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.cwd).toBe(join(tmp, "runs", "inv-1", "repo"));
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("a stored subPath that climbs out of the snapshot is skipped instead of widening the cwd (#848)", async () => {
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: "../../outside", connectionId: null, serviceName: "checkout" },
			]),
			snapshotWith: cloneAs(async () => ({
				path: "/app-data/runs/r1/repo",
				head: "abc123def456789",
				branch: "main" as const,
			})),
		});

		const ws = await resolveWorkspace(minimalData(), ports);
		expect(ws.layout).toBe("unmapped");
		expect(ws.checkoutsSkipped).toEqual([
			{ repo: "https://github.com/acme/api-gateway", code: "failed", reason: expect.stringMatching(/escapes the snapshot/) },
		]);
	});

	it("a repo whose subPath is a junction to an outside dir throws escapes the snapshot and is skipped (#848)", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-junction-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const repoDir = join(tmp, "runs", "inv-1", "repo");
			const outsideDir = join(tmp, "outside");
			mkdirSync(repoDir, { recursive: true });
			mkdirSync(outsideDir, { recursive: true });
			const symlinkType = process.platform === "win32" ? "junction" : "dir";
			symlinkSync(outsideDir, join(repoDir, "linked-sub"), symlinkType);

			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					{
						sourceKind: "url" as const,
						url: "https://github.com/acme/api-gateway",
						defaultBranch: "main",
						subPath: "linked-sub",
						connectionId: null,
						serviceName: "checkout",
					},
				]),
				snapshotWith: cloneAs(async () => ({
					path: repoDir,
					head: "abc123def456789",
					branch: "main" as const,
				})),
			});

			const ws = await resolveWorkspace(minimalData(), ports);
			expect(ws.layout).toBe("unmapped");
			expect(ws.checkoutsSkipped).toEqual([
				{
					repo: "https://github.com/acme/api-gateway",
					code: "failed",
					reason: expect.stringMatching(/escapes the snapshot: linked-sub/),
				},
			]);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("rebuildWorkspace rejects when snapshot restores a link making cwd escape, and leaves missing dir uncreated (OBJ-001)", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-rebuild-esc-"));
		const outside = mkdtempSync(join(os.tmpdir(), "pl-outside-esc-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const runDir = join(tmp, "runs", "inv-1");
			const repoDir = join(runDir, "repo");
			const linked = join(repoDir, "linked");
			const cwd = join(linked, "missing");
			const ws: RunWorkspace = {
				layout: "single",
				cwd,
				repos: [
					{
						name: "repo",
						dir: repoDir,
						head: "abc123def456789",
						sourceKind: "url",
						url: "https://github.com/acme/repo",
						connectionId: null,
						branch: "main",
						subPath: null,
						services: ["api"],
					},
				],
			};
			const ports = fakePorts({
				snapshotWith: vi.fn(async () => {
					mkdirSync(repoDir, { recursive: true });
					symlinkSync(outside, linked, "junction");
					return { snap: {} as never, credential: PUBLIC_CREDENTIAL };
				}),
			});

			await expect(
				rebuildWorkspace(ws, "inv-1", "OpenCode", ports),
			).rejects.toThrow(/is not in the repository/);

			expect(existsSync(join(outside, "missing"))).toBe(false);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("rebuildWorkspace succeeds and cwd exists when linked is a real directory (OBJ-001 control)", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-rebuild-ctrl-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const runDir = join(tmp, "runs", "inv-1");
			const repoDir = join(runDir, "repo");
			const linked = join(repoDir, "linked");
			const cwd = join(linked, "missing");
			const ws: RunWorkspace = {
				layout: "single",
				cwd,
				repos: [
					{
						name: "repo",
						dir: repoDir,
						head: "abc123def456789",
						sourceKind: "url",
						url: "https://github.com/acme/repo",
						connectionId: null,
						branch: "main",
						subPath: null,
						services: ["api"],
					},
				],
			};
			const ports = fakePorts({
				snapshotWith: vi.fn(async () => {
					mkdirSync(cwd, { recursive: true });
					return { snap: {} as never, credential: PUBLIC_CREDENTIAL };
				}),
			});

			const result = await rebuildWorkspace(ws, "inv-1", "OpenCode", ports);
			expect(result.cwd).toBe(cwd);
			expect(existsSync(cwd)).toBe(true);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	describe("rebuildWorkspace creates no folder but the run's own unmapped/ (OBJ-020 #848)", () => {
		function rebuild(cwd: (runDir: string) => string) {
			const tmp = mkdtempSync(join(os.tmpdir(), "pl-rebuild-own-"));
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
			const runDir = join(tmp, "runs", "inv-1");
			const ws: RunWorkspace = { layout: "unmapped", cwd: cwd(runDir), repos: [] };
			return {
				runDir,
				cwd: ws.cwd,
				run: () => rebuildWorkspace(ws, "inv-1", "OpenCode", fakePorts({})),
				done: () => {
					vi.unstubAllEnvs();
					rmSync(tmp, { recursive: true, force: true });
				},
			};
		}

		it("a recorded cwd that is not there is refused, not created", async () => {
			const t = rebuild((runDir) => join(runDir, "a", "sub", "deep"));
			try {
				await expect(t.run()).rejects.toThrow(/is not in the repository/);
				expect(existsSync(join(t.runDir, "a"))).toBe(false);
			} finally {
				t.done();
			}
		});

		it("an unmapped run's own folder is made again", async () => {
			const t = rebuild((runDir) => join(runDir, "unmapped"));
			try {
				const result = await t.run();
				expect(result.cwd).toBe(t.cwd);
				expect(existsSync(t.cwd)).toBe(true);
			} finally {
				t.done();
			}
		});
	});

	it("resolveWorkspace with subPath 'linked/missing' over a junction link skips the repo with code failed (OBJ-001)", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-resolve-junction-"));
		const outside = mkdtempSync(join(os.tmpdir(), "pl-outside-res-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const repoDir = join(tmp, "runs", "inv-1", "repo");
			const linked = join(repoDir, "linked");
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					{
						sourceKind: "url" as const,
						url: "https://github.com/acme/api",
						defaultBranch: "main",
						subPath: "linked/missing",
						connectionId: null,
						serviceName: "checkout",
					},
				]),
				snapshotWith: cloneAs(async () => {
					mkdirSync(repoDir, { recursive: true });
					symlinkSync(outside, linked, "junction");
					return {
						path: repoDir,
						head: "abc123def456789",
						branch: "main" as const,
					};
				}),
			});

			const ws = await resolveWorkspace(minimalData(), ports);
			expect(ws.checkoutsSkipped).toEqual([
				{
					repo: "https://github.com/acme/api",
					code: "failed",
					reason: "the sub-path linked/missing is not in the repository",
				},
			]);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("a linked repo with no connectionId: snapshotWith gets a null connectionId", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const snapshot = cloneAs(async () => ({
				path: "/app-data/repos/github.com/acme/x",
				head: "abc123def456789",
				branch: null,
			}));
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					{ sourceKind: "url" as const, url: "https://github.com/acme/x", defaultBranch: null, subPath: null, connectionId: null, serviceName: "checkout" },
				]),
				snapshotWith: snapshot,
			});

			await resolveWorkspace(minimalData(), ports);

			expect(snapshot).toHaveBeenCalledWith(
				{ sourceKind: "url", url: "https://github.com/acme/x", connectionId: null, defaultBranch: null },
				join(tmp, "runs", "inv-1", "repo"),
				expect.any(AbortSignal),
			);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	describe("every repo the incident touches (#747)", () => {
		let appData = "";
		beforeEach(() => {
			appData = mkdtempSync(join(os.tmpdir(), "pl-ws-"));
		});
		afterEach(() => {
			vi.unstubAllEnvs();
			rmSync(appData, { recursive: true, force: true });
		});
		const under = (...p: string[]) => join(appData, "runs", "inv-1", ...p);
		const at = (dest: string) => ({ path: dest, head: `${dest.endsWith("worker") ? "5d6e7f8" : "1a2b3c4"}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, branch: "main" as const });
		const repo = (url: string, serviceName: string, subPath: string | null = null) => ({
			sourceKind: "url" as const,
			url,
			defaultBranch: "main",
			subPath,
			connectionId: null,
			serviceName,
		});

		it("two services with different repos: repos/api and repos/worker, cwd is their parent, the note names both commits", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", appData);
			const snapshot = cloneAs(async (_src: unknown, dest: string) => {
				if (dest.endsWith("worker")) mkdirSync(join(dest, "svc", "jobs"), { recursive: true });
				return at(dest);
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/api.git", "checkout"),
					repo("git@github.com:o/worker.git", "jobs", "svc/jobs"),
				]),
				snapshotWith: snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(snapshot.mock.calls.map((c) => c[1])).toEqual([
				under("repos", "api"),
				under("repos", "worker"),
			]);
			expect(ws.layout).toBe("multi");
			expect(ws.cwd).toBe(under("repos"));
			expect(ws.repos.map((r) => [r.name, r.services, r.subPath])).toEqual([
				["api", ["checkout"], null],
				["worker", ["jobs"], "svc/jobs"],
			]);
			expect(ws.note).toBe(
				"Investigating snapshots of 2 repositories: api (URL git@github.com:o/api.git) at main 1a2b3c4, worker (URL git@github.com:o/worker.git/svc/jobs) at main 5d6e7f8. Uncommitted changes are not included.",
			);
		});

		it("a repo that cannot be copied is skipped and named in the note; a primary's failure leads the note (#848)", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", appData);
			const snapshot = cloneAs(async (_src: unknown, dest: string) => {
				if (dest.endsWith("worker")) throw new Error("repository not found");
				return at(dest);
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/api.git", "checkout"),
					repo("git@github.com:o/worker.git", "jobs"),
				]),
				snapshotWith: snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.layout).toBe("single");
			expect(ws.cwd).toBe(under("repos", "api"));
			expect(ws.repos.map((r) => r.name)).toEqual(["api"]);
			expect(ws.note).toContain(
				"Not included, because it could not be copied: URL git@github.com:o/worker.git (repository not found).",
			);

			const primaryDown = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/worker.git", "checkout"),
					repo("git@github.com:o/api.git", "jobs"),
				]),
				snapshotWith: snapshot,
			});
			const down = await resolveWorkspace(minimalData(), primaryDown);
			expect(down.layout).toBe("single");
			expect(down.repos.map((r) => r.name)).toEqual(["api"]);
			expect(down.note.startsWith("Not included, because it could not be copied: URL git@github.com:o/worker.git (repository not found).")).toBe(true);
		});

		it("one repository linked by two services is cloned once with both service names", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", appData);
			const snapshot = cloneAs(async (_src: unknown, dest: string) => at(dest));
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("https://github.com/acme/primary", "checkout"),
					repo("https://github.com/acme/primary", "cart", "sub"),
				]),
				snapshotWith: snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(snapshot).toHaveBeenCalledTimes(1);
			expect(ws.layout).toBe("single");
			expect(ws.repos[0]).toMatchObject({ name: "repo", services: ["checkout", "cart"], subPath: null });
		});

		it("two repos with the same folder name: the second gets -2", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", appData);
			const snapshot = cloneAs(async (_src: unknown, dest: string) => at(dest));
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("https://github.com/acme/api", "checkout"),
					repo("https://github.com/other/api", "billing"),
				]),
				snapshotWith: snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.repos.map((r) => r.name)).toEqual(["api", "api-2"]);
		});

		it("a repo whose folder name is a hidden agent config directory gets a safe name", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", appData);
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("https://github.com/acme/.gemini", "checkout"),
					repo("https://github.com/acme/api", "billing"),
				]),
				snapshotWith: cloneAs(async (_src: unknown, dest: string) => at(dest)),
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.repos.map((r) => r.name)).toEqual(["_gemini", "api"]);
		});

		it("the run records the workspace on the row and hands the prompt every repo", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", mkdtempSync(join(os.tmpdir(), "pl-appdata-")));
			const updateStatus = vi.fn(async () => true);
			const ports = fakePorts({
				updateStatus,
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/api.git", "checkout"),
					repo("git@github.com:o/worker.git", "jobs"),
				]),
				snapshotWith: cloneAs(async (_src: unknown, dest: string) => at(dest)),
			});
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (_o, io: { store: { create(): Promise<void> } }) => {
				await io.store.create();
				return { report: { summary: "done", rootCause: null, nextSteps: [] } };
			});

			await runInvestigationJob(
				{ id: "job-1", investigationId: "inv-1", attempts: 1 },
				minimalData(),
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);

			const [, dto] = updateStatus.mock.calls[0] as unknown as [string, { workspace?: string }];
			const savedWs = JSON.parse(dto.workspace ?? "null");
			expect(savedWs).toMatchObject({ layout: "multi", repos: [{ name: "api" }, { name: "worker" }] });
			// T17: the workspace record carries credential per repo
			for (const r of savedWs.repos) {
				expect(r.credential).toEqual({
					source: "none",
					label: "public",
					via: "none",
				});
			}
			const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { workspace?: { repos: { path: string }[] } } }];
			expect(opts.context.workspace?.repos.map((r) => r.path)).toEqual(["api/", "worker/"]);
		});

		it("keeps the harness's last usage_update on the row, and writes nothing for a harness that sends none", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", mkdtempSync(join(os.tmpdir(), "pl-appdata-")));
			const usage = (used: number) => ({ used, size: 400_000, at: "2026-10-20T09:00:00.000Z" });
			const recordUsage = vi.fn(async () => {});
			const ports = fakePorts({ recordUsage, snapshotWith: cloneAs(async (_src: unknown, dest: string) => at(dest)) });
			const run = () =>
				runInvestigationJob(
					{ id: "job-1", investigationId: "inv-1", attempts: 1 },
					minimalData(),
					{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
					ports,
				);
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (o: { onUsage: (u: unknown) => void }, io: { store: { create(): Promise<void> } }) => {
				await io.store.create();
				o.onUsage(usage(1_000));
				o.onUsage(usage(182_000));
				return { report: { summary: "done", rootCause: null, nextSteps: [] } };
			});
			await run();
			expect(recordUsage).toHaveBeenCalledTimes(2);
			expect(recordUsage).toHaveBeenLastCalledWith("inv-1", usage(182_000));

			recordUsage.mockClear();
			mocks.conductRun.mockImplementation(async (_o, io: { store: { create(): Promise<void> } }) => {
				await io.store.create();
				return { report: { summary: "done", rootCause: null, nextSteps: [] } };
			});
			await run();
			expect(recordUsage).not.toHaveBeenCalled();
		});

		it("T17b: a follow-up re-records the workspace with the credential the rebuild resolved", async () => {
			const tmp = mkdtempSync(join(os.tmpdir(), "pl-followup-"));
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
			const runDir = join(tmp, "runs", "inv-followup");
			mkdirSync(runDir, { recursive: true });
			// A follow-up refuses when the harness binary is missing; CI has no opencode.
			const bin = join(tmp, "bin");
			mkdirSync(bin);
			writeFileSync(join(bin, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
			writeFileSync(join(bin, "opencode.cmd"), "@echo off\n", { mode: 0o755 });
			vi.stubEnv("PATH", bin);
			const resolvedCred = {
				source: "connection" as const,
				label: "token Updated",
				via: "git-host-token",
			};
			const ports = fakePorts({
				findInvestigation: vi.fn(async () => ({
					id: "inv-followup",
					status: "pending",
					harness: "opencode",
					model: "opencode/some-model",
					acpSessionId: "ses_abc",
					workspace: JSON.stringify({
						layout: "single",
						cwd: join(runDir, "repo"),
						repos: [
							{
								name: "repo",
								dir: join(runDir, "repo"),
								sourceKind: "url",
								url: "https://github.com/acme/api",
								subPath: null,
								connectionId: null,
								head: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
								branch: "main",
								services: ["checkout"],
								credential: { source: "none", label: "public", via: "none" },
							},
						],
					}),
				})),
				lastEventSeq: vi.fn(async () => 10),
				snapshotWith: vi.fn(async () => {
					mkdirSync(join(runDir, "repo"));
					return {
						snap: {
							path: join(runDir, "repo"),
							head: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
							branch: "main",
						},
						credential: resolvedCred,
					};
				}),
			});

			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(
				async (_o, ioRun: { store: { create(): Promise<void>; append(e: CanonicalEvent): Promise<void> } }) => {
					await ioRun.store.create();
					await ioRun.store.append({ kind: "operator_message", runId: "inv-followup", branchId: "b", path: [], ts: "2026-10-11T00:00:00.000Z", seq: 42, text: "go", mode: "queue", delivered: true });
					return { runId: "inv-followup", report: null, error: null, failureKind: "none" };
				},
			);

			await runInvestigationJob(
				{ id: "job-followup", investigationId: "inv-followup", attempts: 1 },
				{
					investigationId: "inv-followup",
					incidentId: "inc-followup",
					resume: {
						text: "how about the rebuilt credential?",
						mode: "queue",
						restore: { status: "completed", completedAt: "2026-09-30T10:00:00.000Z", error: null },
					},
				},
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);

			// The follow-up rebuilds workspace with snapshotWith and passes updated workspace JSON to store
			expect(ports.snapshotWith).toHaveBeenCalled();
			expect(mocks.conductRun).toHaveBeenCalled();
			const [, dto] = vi.mocked(ports.followUpStatus).mock.calls[1] as [string, { workspace?: string }];
			expect(JSON.parse(dto.workspace ?? "null").repos[0].credential).toEqual(resolvedCred);
			rmSync(tmp, { recursive: true, force: true });
		});
	});

	it("a folder-source repo: snapshot gets kind 'folder' with the folder path as source, and the note says so", async () => {
		const snapshot = cloneAs(async () => ({
			path: "/app-data/runs/inv-1/repo",
			head: "abc123def456789",
			branch: null,
		}));
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{
					sourceKind: "folder" as const,
					url: "/home/dev/checkouts/api-gateway",
					defaultBranch: null,
					subPath: null,
					connectionId: null,
					serviceName: "checkout",
				},
			]),
			snapshotWith: snapshot,
		});

		const ws = await resolveWorkspace(minimalData(), ports);

		expect(snapshot).toHaveBeenCalledWith(
			{
				sourceKind: "folder",
				url: "/home/dev/checkouts/api-gateway",
				connectionId: null,
				defaultBranch: null,
			},
			expect.any(String),
			expect.any(AbortSignal),
		);
		expect(ws.note).toContain("folder");
	});
});

describe("runInvestigationJob schema validation", () => {
	it("malformed job payload -> throws, not silent degradation", async () => {
		const job = { id: "job-malformed", investigationId: "inv-malformed", attempts: 1 };
		const malformedData = {
			// Missing required incidentId and investigationId
			priority: "invalid-priority",
		};

		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: the point is an invalid payload.
			runInvestigationJob(job, malformedData as any, {
				emit: vi.fn(),
				streamDone: vi.fn(),
				signal: new AbortController().signal,
			}, fakePorts()),
		).rejects.toThrow();
	});

	it("missing or absent alerts remains valid per schema", async () => {
		const validJobWithoutAlerts = {
			incidentId: "inc-123",
			investigationId: "inv-123",
		};
		const { InvestigationJobDataSchema } = await import("@prismalens/contracts");
		expect(() =>
			InvestigationJobDataSchema.parse(validJobWithoutAlerts),
		).not.toThrow();
	});

	// Follow-up 4, issue #302 / #537: the schema parse lives INSIDE the
	// failure-persisting try/catch. A payload that carries usable identifiers but fails
	// validation must still leave a terminal "failed" investigation row and a timeline
	// entry — never a row dangling at "pending" because the parse threw past the handler.
	it("parse failure still persists a failed status and timeline entry from the raw identifiers", async () => {
		const updateStatus = vi.fn(
			async (
				_id: string,
				_dto: {
					status: "running" | "failed" | "completed" | "cancelled";
					error?: string;
					harnessThreadId?: string;
					startedAt?: Date;
				},
			) => true,
		);
		const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
		const ports = fakePorts({ updateStatus, createTimelineEntry });

		const job = { id: "job-parse-fail", investigationId: "inv-parse-fail", attempts: 1 };
		const malformedDataWithIds = {
			investigationId: "inv-parse-fail",
			incidentId: "inc-parse-fail",
			priority: "invalid-priority",
		};

		await expect(
			runInvestigationJob(job, malformedDataWithIds as never, {
				emit: vi.fn(),
				streamDone: vi.fn(),
				signal: new AbortController().signal,
			}, ports),
		).rejects.toThrow();

		expect(updateStatus).toHaveBeenCalledWith(
			"inv-parse-fail",
			expect.objectContaining({ status: "failed" }),
		);
		const [, statusDto] = updateStatus.mock.calls[0];
		expect((statusDto as { error?: string }).error).toContain("priority");

		expect(createTimelineEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "inc-parse-fail",
				type: "investigation_completed",
				title: "Investigation failed",
				source: "ai_worker",
				metadata: expect.objectContaining({ investigationId: "inv-parse-fail" }),
			}),
		);
	});

	// Refusal path (#520, ADR-0031): an unrunnable harness selection must fail the run
	// with the selection's own reason, not a generic error.
	it("an unrunnable harness selection fails the job with the selection's reason", async () => {
		const updateStatus = vi.fn(async () => true);
		const ports = fakePorts({
			updateStatus,
			resolveHarness: vi.fn(async () => ({
				selection: {
					runnable: false as const,
					failure: "no-harness" as const,
					reason: "No coding agent found on PATH.",
				},
			})),
		});

		await expect(
			runInvestigationJob(
				{ id: "job-1", investigationId: "inv-1", attempts: 1 },
				{ investigationId: "inv-1", incidentId: "inc-1" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			),
		).rejects.toThrow(/No coding agent found on PATH/);

		expect(updateStatus).toHaveBeenCalledWith(
			"inv-1",
			expect.objectContaining({ status: "failed", error: "No coding agent found on PATH." }),
		);
	});
});

/**
 * 0005 §2 regression: `getIncident` hands back the raw Prisma row now, not a
 * JSON-round-tripped one — `triggeredAt` is a real `Date`, not a string. The
 * degenerate no-alerts path used to cast it straight to `string`, which built
 * a `FiringAlert` the contract schema then rejected downstream. Verified here
 * through the context `conductRun` actually receives.
 */
describe("assembled investigation context (Date-typed incident fields)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("does not throw when the incident's date fields are real Date instances", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({
				title: "No alerts here",
				triggeredAt: new Date("2026-07-31T10:00:00.000Z"),
			})),
		});

		await runInvestigationJob(
			{ id: "job-no-alerts", investigationId: "inv-no-alerts", attempts: 1 },
			{ investigationId: "inv-no-alerts", incidentId: "inc-no-alerts" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { alerts: Array<{ startsAt: string | null }> } }];
		expect(opts.context.alerts).toHaveLength(1);
		expect(opts.context.alerts[0].startsAt).toBe("2026-07-31T10:00:00.000Z");
	});
});

describe("the agent's own mode (#673 w21)", () => {
	it("asks for the job's level, else the resolved one, else Ask always, and keeps it on the row", async () => {
		const levelOf = async (job: { accessLevel?: AccessLevel }, resolved?: AccessLevel) => {
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (_o, io: { store: { create(): Promise<void> } }) => {
				await io.store.create();
				return { report: { summary: "done", rootCause: null, nextSteps: [] } };
			});
			const ports = fakePorts();
			const resolve = ports.resolveHarness;
			ports.resolveHarness = vi.fn(async () => ({ ...(await resolve()), ...(resolved ? { accessLevel: resolved } : {}) }));
			await runInvestigationJob(
				{ id: "job-mode", investigationId: "inv-mode", attempts: 1 },
				{ investigationId: "inv-mode", incidentId: "inc-mode", ...job },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);
			const [opts] = mocks.conductRun.mock.calls[0] as [{ accessLevel?: AccessLevel }];
			expect(ports.updateStatus).toHaveBeenCalledWith(
				"inv-mode",
				expect.objectContaining({ accessLevel: opts.accessLevel }),
			);
			return opts.accessLevel;
		};
		expect(await levelOf({ accessLevel: "full-access" }, "auto")).toBe("full-access");
		expect(await levelOf({}, "auto")).toBe("auto");
		expect(await levelOf({})).toBe("supervised");
	});
});

describe("the run's own agent, model and effort (#673 w52)", () => {
	it("asks the ports for the job's choice and keeps the effort on the row", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockImplementation(async (_o, io: { store: { create(): Promise<void> } }) => {
			await io.store.create();
			return { report: { summary: "done", rootCause: null, nextSteps: [] } };
		});
		const ports = fakePorts();
		const resolve = ports.resolveHarness;
		ports.resolveHarness = vi.fn(async () => ({ ...(await resolve()), effort: "high" }));
		await runInvestigationJob(
			{ id: "job-choice", investigationId: "inv-choice", attempts: 1 },
			{ investigationId: "inv-choice", incidentId: "inc-choice", harness: "opencode", model: null, effort: "high" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);
		expect(ports.resolveHarness).toHaveBeenCalledWith({ harness: "opencode", model: null, effort: "high" });
		const [opts] = mocks.conductRun.mock.calls[0] as [{ effort?: string }];
		expect(opts.effort).toBe("high");
		expect(ports.updateStatus).toHaveBeenCalledWith("inv-choice", expect.objectContaining({ effort: "high" }));
	});
});

/**
 * ADR 0004 §5 / #628: the harness child never gets `process.env` verbatim. The
 * only env `conductRun` receives is the resolved harness's own provider keys,
 * never a `PRISMALENS_*` name — even one sitting right next to a real
 * provider key in the parent process.
 */
describe("harness child env (trust floor, #628)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("passes the resolved harness's provider keys, never PRISMALENS_* or the rest of process.env", async () => {
		vi.stubEnv("PRISMALENS_AUTH_SECRET", "leak-me");
		vi.stubEnv("PRISMALENS_WEBHOOK_SECRET", "leak-me-too");
		vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
		vi.stubEnv("SOME_UNRELATED_HOST_VAR", "noise");
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts();

		await runInvestigationJob(
			{ id: "job-env", investigationId: "inv-env", attempts: 1 },
			{ investigationId: "inv-env", incidentId: "inc-env" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ env: Record<string, string> }];
		// `resolveHarness` in `fakePorts` defaults to opencode, which lists
		// ANTHROPIC_API_KEY among its provider keys (registry row).
		expect(opts.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
		expect(opts.env.PRISMALENS_AUTH_SECRET).toBeUndefined();
		expect(opts.env.PRISMALENS_WEBHOOK_SECRET).toBeUndefined();
		expect(opts.env.SOME_UNRELATED_HOST_VAR).toBeUndefined();
	});
});

describe("run snapshot reaping (#637 N3)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("deletes runs/<id>/repo when the job ends and keeps the transcript", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-reap-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const runDir = join(tmp, "runs", "inv-reap");
			mkdirSync(join(runDir, "repo"), { recursive: true });
			writeFileSync(join(runDir, "repo", "file.txt"), "x");
			writeFileSync(join(runDir, "transcript.jsonl"), "{}\n");
			mocks.conductRun.mockReset();
			mocks.conductRun.mockResolvedValue({
				report: { summary: "done", rootCause: null, nextSteps: [] },
			});

			await runInvestigationJob(
				{ id: "job-reap", investigationId: "inv-reap", attempts: 1 },
				{ investigationId: "inv-reap", incidentId: "inc-reap" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				fakePorts(),
			);

			expect(existsSync(join(runDir, "repo"))).toBe(false);
			expect(existsSync(join(runDir, "transcript.jsonl"))).toBe(true);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runDirFor (#643 review)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("keeps a run directory directly under runs/ and refuses an id that escapes it", () => {
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", "/ws");
		expect(runDirFor("0b3c2f1e-1111-4222-8333-444455556666")).toBe(
			"/ws/runs/0b3c2f1e-1111-4222-8333-444455556666",
		);
		for (const bad of ["../../etc", "a/b", "..", "", "staging/../other-id"]) {
			expect(() => runDirFor(bad), bad).toThrow(/Invalid investigation id/);
		}
	});
});

describe("connector resolution into investigation telemetry (#633)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("records telemetry.prometheus hostname in investigation_started metadata when resolver returns prometheus", async () => {
		const timelineMock = vi.fn(async () => {});
		const ports = fakePorts({
			createTimelineEntry: timelineMock,
			getIncident: vi.fn(async () => ({
				id: "inc-telemetry",
				title: "Prometheus alert",
				serviceId: "svc-1",
			})),
			resolveConnectors: vi.fn(async () => [
				{
					templateId: "prometheus",
					connectionId: "conn-1",
					label: "Prometheus",
					baseUrl: "http://prom.internal:9090",
					segments: ["metrics"],
				},
			]),
		});
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});

		await runInvestigationJob(
			{ id: "job-telemetry", investigationId: "inv-telemetry", attempts: 1 },
			{ investigationId: "inv-telemetry", incidentId: "inc-telemetry" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(timelineMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "investigation_started",
				metadata: expect.objectContaining({
					telemetry: { prometheus: "prom.internal" },
				}),
			}),
		);
	});

	it("proceeds with no telemetry when resolveConnectors throws", async () => {
		const timelineMock = vi.fn(async () => {});
		const ports = fakePorts({
			createTimelineEntry: timelineMock,
			getIncident: vi.fn(async () => ({
				id: "inc-err",
				title: "Prometheus alert",
				serviceId: "svc-1",
			})),
			resolveConnectors: vi.fn(async () => {
				throw new Error("DB error resolving connectors");
			}),
		});
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});

		const result = await runInvestigationJob(
			{ id: "job-err", investigationId: "inv-err", attempts: 1 },
			{ investigationId: "inv-err", incidentId: "inc-err" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(result.success).toBe(true);
		expect(timelineMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "investigation_started",
				metadata: expect.not.objectContaining({
					telemetry: expect.anything(),
				}),
			}),
		);
	});
});

describe("context pack reaches the run (#633)", () => {
	const PACK = {
		window: { start: "2026-09-19T00:00:00Z", end: "2026-09-20T00:00:00Z" },
		changes: [],
		neighbors: [],
		priorIncidents: [],
		unavailable: [],
		assembledAt: "2026-09-20T00:00:00Z",
	};

	it("passes the assembled context pack into conductRun's context", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts({ contextPack: vi.fn(async () => PACK) });

		await runInvestigationJob(
			{ id: "job-pack", investigationId: "inv-pack", attempts: 1 },
			{ investigationId: "inv-pack", incidentId: "inc-pack" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(ports.contextPack).toHaveBeenCalledWith("inc-pack");
		const [runArgs] = mocks.conductRun.mock.calls[0] as unknown as [
			{ context: { contextPack?: unknown } },
		];
		expect(runArgs.context.contextPack).toEqual(PACK);
	});

	it("proceeds with no context pack when the port throws", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts({
			contextPack: vi.fn(async () => {
				throw new Error("DB error assembling context pack");
			}),
		});

		const result = await runInvestigationJob(
			{ id: "job-pack-err", investigationId: "inv-pack-err", attempts: 1 },
			{ investigationId: "inv-pack-err", incidentId: "inc-pack-err" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(result.success).toBe(true);
		const [runArgs] = mocks.conductRun.mock.calls[0] as unknown as [
			{ context: { contextPack?: unknown } },
		];
		expect(runArgs.context.contextPack).toBeUndefined();
	});
});


/**
 * A message on a finished run continues the same session in the first run's
 * workspace, rebuilt at the same path and commits; it is chat only (#747).
 */
describe("follow-up on a finished run (#747)", () => {
	const HEAD = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(os.tmpdir(), "pl-followup-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		const bin = join(tmp, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
		writeFileSync(join(bin, "opencode.cmd"), "@echo off\n", { mode: 0o755 });
		vi.stubEnv("PATH", bin);
		mocks.conductRun.mockReset();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tmp, { recursive: true, force: true });
	});

	const restore = { status: "completed" as const, completedAt: "2026-09-30T10:00:00.000Z", error: null };
	const data: InvestigationJobData = {
		investigationId: "inv-1",
		incidentId: "inc-1",
		resume: { text: "why the pool?", mode: "queue", restore },
	};
	function recorded(dir: string) {
		return JSON.stringify({
			layout: "single",
			cwd: dir,
			repos: [
				{ name: "repo", dir, sourceKind: "url", url: "https://github.com/acme/api", subPath: null, connectionId: null, head: HEAD, branch: "main", services: ["checkout"] },
			],
		});
	}
	function followUpPorts(overrides: Partial<RunPorts> = {}) {
		const dir = join(tmp, "runs", "inv-1", "repo");
		return fakePorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(dir),
			})),
			lastEventSeq: vi.fn(async () => 41),
			snapshotWith: cloneAs(async (_src: unknown, dest: string) => ({ path: dest, head: HEAD, branch: null })),
			...overrides,
		});
	}
	const io = () => ({ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal });

	it("rebuilds at the recorded commit and path, loads the same session after the stored events, and puts the row back untouched", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(true);
		expect(ports.snapshotWith).toHaveBeenCalledWith(
			{ sourceKind: "url", url: "https://github.com/acme/api", connectionId: null },
			join(tmp, "runs", "inv-1", "repo"),
			expect.any(AbortSignal),
			HEAD,
		);
		expect(ports.clearEvents).not.toHaveBeenCalled();
		const [opts] = mocks.conductRun.mock.calls[0] as [
			{ seqStart: number; model: string; resume: { sessionId: string; text: string; heads: unknown } },
		];
		expect(opts.seqStart).toBe(42);
		expect(opts.model).toBe("opencode/some-model");
		expect(opts.resume).toMatchObject({ sessionId: "ses_abc", text: "why the pool?", heads: [{ name: "repo", head: HEAD }] });
		expect(ports.createTimelineEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Investigation resumed",
				description: "Continuing the same OpenCode session in a fresh workspace pinned to 1a2b3c4.",
			}),
		);
		// An Ask: no report write, no status write that delivers; the standing is kept (#673 w59, I1).
		expect(ports.writeResult).not.toHaveBeenCalled();
		expect(ports.updateStatus).not.toHaveBeenCalled();
		expect(vi.mocked(ports.settleFollowUp).mock.calls).toEqual([
			[
				"inv-1",
				{ status: "completed", completedAt: new Date(restore.completedAt), error: null, lastTurnOutcome: "answered" },
				{ stopped: false },
			],
		]);
		expect(existsSync(join(tmp, "runs", "inv-1", "repo"))).toBe(false);
	});

	it("runFollowUp passes kind: 'chat' to conductRun when investigation is a chat run (#817)", async () => {
		const dir = join(tmp, "runs", "inv-1", "repo");
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				kind: "chat",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(dir),
			})),
		});
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		const result = await runInvestigationJob({ id: "job-chat", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(true);
		expect(mocks.conductRun).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "chat",
			}),
			expect.anything(),
		);
	});

	it("reuses its run's stored pre-run snapshot and fetches nothing (#848)", async () => {
		const { buildPreRunSnapshot } = await import("./pre-run-context.js");
		const saved = buildPreRunSnapshot({
			window: { start: new Date("2026-10-24T09:00:00Z"), end: new Date("2026-10-24T10:00:00Z") },
			telemetry: [{ kind: "loki", label: "logs", from: "set", status: "skipped", reason: "the source did not answer in time" }],
			pastIncidents: [],
			runbooks: [],
			now: new Date("2026-10-24T10:00:00Z"),
		});
		const telemetry = vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] }));
		const ports = followUpPorts({
			preRun: {
				telemetry,
				runbooks: vi.fn(async () => ({ entries: [] })),
				save: vi.fn(async () => {}),
				load: vi.fn(async () => JSON.stringify(saved)),
			},
		});
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		await runInvestigationJob({ id: "job-pre", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(telemetry).not.toHaveBeenCalled();
		const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { preRun?: { state: string; sources: unknown } } }];
		expect(opts.context.preRun).toMatchObject({ state: "ready", sources: saved.sources });
	});

	it("follow-up when load returns null gives unavailable and fetches no telemetry (#848)", async () => {
		const telemetry = vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] }));
		const save = vi.fn(async () => {});
		const ports = followUpPorts({
			preRun: {
				telemetry,
				runbooks: vi.fn(async () => ({ entries: [] })),
				save,
				load: vi.fn(async () => null),
			},
		});
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		await runInvestigationJob({ id: "job-null-load", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(telemetry).not.toHaveBeenCalled();
		const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { preRun?: { state: string; reason: string } } }];
		expect(opts.context.preRun).toEqual({ state: "unavailable", reason: "no stored snapshot for this run" });
		const { PreRunContextSchema } = await import("@prismalens/contracts/schemas");
		expect(PreRunContextSchema.safeParse(opts.context.preRun).success).toBe(true);
		await vi.waitFor(() => {
			expect(save).toHaveBeenCalledWith(
				"inv-1",
				JSON.stringify({ state: "unavailable", reason: "no stored snapshot for this run" }),
			);
		});
	});

	it("follow-up when load returns a not-saved marker gives unavailable reason and does not save (#848)", async () => {
		const { buildPreRunSnapshot, notSavedMarker } = await import("./pre-run-context.js");
		const saved = buildPreRunSnapshot({
			window: { start: new Date("2026-10-24T09:00:00Z"), end: new Date("2026-10-24T10:00:00Z") },
			telemetry: [],
			pastIncidents: [],
			runbooks: [],
			now: new Date("2026-10-24T10:00:00Z"),
		});
		const save = vi.fn(async () => {});
		const notSaved = notSavedMarker(saved, "write failed");
		const ports = followUpPorts({
			preRun: {
				telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save,
				load: vi.fn(async () => notSaved),
			},
		});
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		await runInvestigationJob({ id: "job-not-saved-load", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { preRun?: { state: string; reason: string } } }];
		expect(opts.context.preRun).toEqual({
			state: "unavailable",
			reason: "the run's snapshot was not saved",
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("follow-up when load times out or returns unparsable text does not save (#848)", async () => {
		const save = vi.fn(async () => {});
		const portsBadJson = followUpPorts({
			preRun: {
				telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save,
				load: vi.fn(async () => "{ not json"),
			},
		});
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		await runInvestigationJob({ id: "job-bad-json", investigationId: "inv-1", attempts: 1 }, data, io(), portsBadJson);
		expect(save).not.toHaveBeenCalled();

		vi.useFakeTimers();
		try {
			const saveTimeout = vi.fn(async () => {});
			const portsTimeout = followUpPorts({
				preRun: {
					telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
					runbooks: vi.fn(async () => ({ entries: [] })),
					save: saveTimeout,
					load: vi.fn(() => new Promise<string | null>(() => {})),
				},
			});
			const jobPromise = runInvestigationJob({ id: "job-load-timeout-nosave", investigationId: "inv-1", attempts: 1 }, data, io(), portsTimeout);
			await vi.advanceTimersByTimeAsync(5_100);
			await jobPromise;
			expect(saveTimeout).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("save on first run, then follow-up loads and rewrites the read copies (#848)", async () => {
		let savedSnapshotText: string | undefined;
		mocks.conductRun.mockResolvedValue({ runId: "inv-good", report: null, error: null, failureKind: "none" });
		const { delimiter } = await import("node:path");
		const gitDir = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd" : "/usr/bin";
		vi.stubEnv("PATH", `${join(tmp, "bin")}${delimiter}${gitDir}`);
		const firstPorts = fakePorts({
			preRun: {
				telemetry: vi.fn(async () => ({
					sources: [
						{
							kind: "loki" as const,
							label: "LOKI_URL",
							from: "env" as const,
							status: "found" as const,
							part: { summary: "3 error log lines", data: { result: [] }, count: 3 },
							secrets: [],
						},
					],
					notConfigured: [],
					endpoints: [],
				})),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save: vi.fn(async (_id: string, text: string) => {
					savedSnapshotText = text;
				}),
				load: vi.fn(async () => null),
			},
		});

		await runInvestigationJob(
			{ id: "job-good-first", investigationId: "inv-good", attempts: 1 },
			{ investigationId: "inv-good", incidentId: "inc-1" },
			io(),
			firstPorts,
		);
		expect(savedSnapshotText).toBeDefined();

		mocks.conductRun.mockReset();
		const followPorts = followUpPorts({
			preRun: {
				telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save: vi.fn(async () => {}),
				load: vi.fn(async () => savedSnapshotText!),
			},
			snapshotWith: cloneAs(async (_src: unknown, dest: string) => {
				mkdirSync(dest, { recursive: true });
				const { execSync } = await import("node:child_process");
				execSync("git init", { cwd: dest, stdio: "ignore" });
				return { path: dest, head: HEAD, branch: null };
			}),
		});
		let followCopied = false;
		mocks.conductRun.mockImplementation(async (o: { cwd: string }, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			followCopied = existsSync(join(o.cwd, ".prismalens", "runs", "inv-1", "telemetry-loki-1.json"));
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		const result = await runInvestigationJob({ id: "job-follow-good", investigationId: "inv-1", attempts: 1 }, data, io(), followPorts);
		expect(result.error).toBeUndefined();
		expect(result.success).toBe(true);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { preRun?: { state: string; copy: { state: string } } } }];
		expect(opts.context.preRun?.state).toBe("ready");
		expect(opts.context.preRun?.copy.state).toBe("written");
		expect(followCopied).toBe(true);
	});

	it("a load that never settles still lets conductRun start within 5 s on follow-up (#848)", async () => {
		vi.useFakeTimers();
		try {
			const neverSettlingLoad = new Promise<string | null>(() => {});
			const ports = followUpPorts({
				preRun: {
					telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
					runbooks: vi.fn(async () => ({ entries: [] })),
					save: vi.fn(async () => {}),
					load: vi.fn(() => neverSettlingLoad),
				},
			});
			mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
				await run.store.create();
				return { runId: "inv-1", report: null, error: null, failureKind: "none" };
			});

			const jobPromise = runInvestigationJob({ id: "job-load-timeout", investigationId: "inv-1", attempts: 1 }, data, io(), ports);
			await vi.advanceTimersByTimeAsync(5_100);
			const result = await jobPromise;

			expect(result.success).toBe(true);
			const [opts] = mocks.conductRun.mock.calls[0] as [
				{ context: { preRun?: { state: string; reason?: string } } },
			];
			expect(opts.context.preRun?.state).toBe("unavailable");
			expect(opts.context.preRun?.reason).toBe("the stored snapshot did not load in 5 s");
		} finally {
			vi.useRealTimers();
		}
	});

	it("hands off to a fresh session of another agent, carrying every message and refuted hypothesis, at the run's own level or narrower", async () => {
		for (const bin of ["codex-acp", "codex-acp.cmd"])
			writeFileSync(join(tmp, "bin", bin), "#!/bin/sh\n", { mode: 0o755 });
		const report = {
			summary: "Pool exhausted",
			rootCause: null,
			hypotheses: [
				{ statement: "pool max=10", status: "supported", evidence: [] },
				{ statement: "the cache", status: "refuted", evidence: [] },
			],
			ruledOut: [],
			nextSteps: [],
		};
		const said = (text: string, seq: number): CanonicalEvent => ({
			kind: "operator_message", runId: "inv-1", branchId: "run", path: [], seq, label: null, ts: new Date().toISOString(), text, mode: "queue", delivered: true,
		});
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(join(tmp, "runs", "inv-1", "repo")),
				report: JSON.stringify(report),
			})),
			events: vi.fn(async () => [said("look at checkout", 1), said("not the cache", 2)]),
			resolveHarness: vi.fn(async () => ({ selection: { runnable: true, harness: "codex", auto: false }, model: "gpt-x" })) as never,
			// The clone is untrusted: it commits .prismalens-handoff as a link out of the workspace.
			snapshotWith: cloneAs(async (_src: unknown, dest: string) => {
				mkdirSync(dest, { recursive: true });
				symlinkSync(join(tmp, "outside"), join(dest, ".prismalens-handoff"), "junction");
				return { path: dest, head: HEAD, branch: null };
			}),
		});
		const repo = join(tmp, "runs", "inv-1", "repo");
		const outside = join(tmp, "outside");
		mkdirSync(outside, { recursive: true });
		let written: { linked: boolean; text: string } | undefined;
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			written = {
				linked: lstatSync(join(repo, ".prismalens-handoff")).isSymbolicLink(),
				text: readFileSync(join(repo, ".prismalens-handoff", "transcript.md"), "utf8"),
			};
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		await runInvestigationJob(
			{ id: "job-2", investigationId: "inv-1", attempts: 1 },
			{ ...data, resume: { ...data.resume!, to: { harness: "codex" }, handoff: true, afterRestart: true } },
			io(),
			ports,
		);
		expect(written?.linked).toBe(false);
		expect(written?.text).toContain("not the cache");
		expect(existsSync(join(outside, "transcript.md"))).toBe(false);

		const [opts] = mocks.conductRun.mock.calls[0] as [
			{ harness: string; model: string; accessLevel: string; resume: { sessionId?: string; handoff: string; via: { harness: string; handoff: { carried: string } } } },
		];
		expect(opts.harness).toBe("codex");
		expect(opts.model).toBe("gpt-x");
		expect(opts.accessLevel).toBe("supervised");
		expect(opts.resume.sessionId).toBeUndefined();
		expect(opts.resume.handoff).toContain("1. look at checkout\n2. not the cache");
		expect(opts.resume.handoff).toContain("- [refuted] the cache");
		expect(opts.resume.handoff).toContain("may or may not have completed");
		expect(opts.resume.via).toMatchObject({
			harness: "codex",
			handoff: { from: "opencode", carried: "the alert, 2 messages, the report and 1 refuted hypothesis" },
		});
	});

	it("refuses a recipient that is no longer runnable on handoff (handoff-L7)", async () => {
		for (const bin of ["codex-acp", "codex-acp.cmd"])
			writeFileSync(join(tmp, "bin", bin), "#!/bin/sh\n", { mode: 0o755 });
		const report = {
			summary: "Pool exhausted",
			rootCause: null,
			hypotheses: [],
			ruledOut: [],
			nextSteps: [],
		};
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(join(tmp, "runs", "inv-1", "repo")),
				report: JSON.stringify(report),
			})),
			events: vi.fn(async () => []),
			resolveHarness: vi.fn(async () => ({
				selection: {
					runnable: false,
					failure: "model-unsupported",
					reason: "Codex refuses gpt-x.",
					harness: "codex",
				},
			})) as unknown as RunPorts["resolveHarness"],
		});

		const result = await runInvestigationJob(
			{ id: "job-2", investigationId: "inv-1", attempts: 1 },
			{ ...data, resume: { ...data.resume!, to: { harness: "codex" }, handoff: true } },
			io(),
			ports,
		);

		expect(mocks.conductRun).not.toHaveBeenCalled();
		expect(result.success).toBe(false);
		expect(vi.mocked(ports.settleFollowUp).mock.calls.at(-1)).toEqual([
			"inv-1",
			{
				status: "completed",
				completedAt: new Date(restore.completedAt),
				error: null,
				lastTurnOutcome: "error",
			},
			{ stopped: false },
		]);
		expect(result.error).toContain("Codex refuses gpt-x.");
		expect(ports.appendEvents).toHaveBeenCalledWith(
			"inv-1",
			expect.arrayContaining([
				expect.objectContaining({
					kind: "error",
					message: expect.stringContaining("Codex refuses gpt-x."),
				}),
			]),
		);
	});

	it("puts a continued run back when it fails before the row went live (R4.4)", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockRejectedValue(new Error("db down"));

		const result = await runInvestigationJob(
			{ id: "job-2", investigationId: "inv-1", attempts: 1 },
			{ ...data, resume: { ...data.resume!, kind: "continue" } },
			io(),
			ports,
		);

		expect(result.success).toBe(false);
		expect(vi.mocked(ports.settleFollowUp).mock.calls.at(-1)).toEqual([
			"inv-1",
			{ status: "completed", completedAt: new Date(restore.completedAt), error: null, lastTurnOutcome: "error" },
			{ stopped: false },
		]);
	});

	it("leaves a continued run that went live to own its end state (R4.4)", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: "agent died", failureKind: "error" };
		});

		await runInvestigationJob(
			{ id: "job-2", investigationId: "inv-1", attempts: 1 },
			{ ...data, resume: { ...data.resume!, kind: "continue" } },
			io(),
			ports,
		);

		expect(vi.mocked(ports.followUpStatus).mock.calls.map(([, dto]) => dto.status)).toEqual(["running"]);
	});

	it("tells the engine the reopened run's model was the operator's, so the agent must take it (R4.2)", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockResolvedValue({ runId: "inv-1", report: null, error: null, failureKind: "none" });

		await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ model: string; modelSource: string }];
		expect(opts).toMatchObject({ model: "opencode/some-model", modelSource: "operator" });
	});

	it("passes resume.newer to conductRun when newerRun returns a different head (#673 w27)", async () => {
		const newer = { number: 2, heads: [{ name: "repo", head: "9f8e7d6c5b4a3210" }] };
		const ports = followUpPorts({
			newerRun: vi.fn(async () => newer),
		});
		mocks.conductRun.mockResolvedValue({ runId: "inv-1", report: null, error: null, failureKind: "none" });

		await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ resume: { newer?: typeof newer } }];
		expect(opts.resume.newer).toEqual(newer);
	});

	it("passes no newer to conductRun when newerRun returns the same head (#673 w27)", async () => {
		const same = { number: 2, heads: [{ name: "repo", head: HEAD }] };
		const ports = followUpPorts({
			newerRun: vi.fn(async () => same),
		});
		mocks.conductRun.mockResolvedValue({ runId: "inv-1", report: null, error: null, failureKind: "none" });

		await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ resume: { newer?: unknown } }];
		expect(opts.resume.newer).toBeUndefined();
	});

	it("passes no newer and still runs when newerRun rejects (#673 w27)", async () => {
		const ports = followUpPorts({
			newerRun: vi.fn(async () => {
				throw new Error("db failure");
			}),
		});
		mocks.conductRun.mockResolvedValue({ runId: "inv-1", report: null, error: null, failureKind: "none" });

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(true);
		const [opts] = mocks.conductRun.mock.calls[0] as [{ resume: { newer?: unknown } }];
		expect(opts.resume.newer).toBeUndefined();
	});

	it("refuses a run whose agent kept no session, says so in the conversation, and puts the row back", async () => {
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "opencode",
				model: null,
				acpSessionId: null,
				workspace: null,
			})),
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(false);
		expect(result.error).toBe("This run cannot be continued: its agent kept no session to reopen.");
		expect(mocks.conductRun).not.toHaveBeenCalled();
		const [, events] = vi.mocked(ports.appendEvents).mock.calls[0] as [string, CanonicalEvent[]];
		expect(events.map((e) => [e.kind, e.seq])).toEqual([
			["operator_message", 42],
			["error", 43],
		]);
		expect(ports.updateStatus).not.toHaveBeenCalled();
		expect(vi.mocked(ports.settleFollowUp).mock.calls.at(-1)?.[1]).toMatchObject({
			status: "completed",
			lastTurnOutcome: "error",
		});
	});

	it("refuses to continue on a harness that can't reopen a session (deepagents), before any clone or conductRun", async () => {
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "deepagents",
				model: "deepagents/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(join(tmp, "runs", "inv-1", "repo")),
			})),
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(false);
		expect(result.error).toBe("deepagents can't reopen a finished session, so a new run starts from the report.");
		expect(mocks.conductRun).not.toHaveBeenCalled();
		expect(ports.snapshotWith).not.toHaveBeenCalled();
	});

	it("a commit the source lost fails with git's own text, and no clone is left", async () => {
		const ports = followUpPorts({
			snapshotWith: cloneAs(async (_src: unknown, dest: string) => {
				mkdirSync(dest, { recursive: true });
				throw new Error(`fatal: reference is not a tree: ${HEAD}`);
			}),
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.error).toBe(`fatal: reference is not a tree: ${HEAD}`);
		expect(existsSync(join(tmp, "runs", "inv-1", "repo"))).toBe(false);
	});

	it("the new session's usage is written after the handoff is recorded (handoff-L8)", async () => {
		for (const bin of ["codex-acp", "codex-acp.cmd"])
			writeFileSync(join(tmp, "bin", bin), "#!/bin/sh\n", { mode: 0o755 });
		const report = {
			summary: "Pool exhausted",
			rootCause: null,
			hypotheses: [
				{ statement: "pool max=10", status: "supported", evidence: [] },
				{ statement: "the cache", status: "refuted", evidence: [] },
			],
			ruledOut: [],
			nextSteps: [],
		};
		const said = (text: string, seq: number): CanonicalEvent => ({
			kind: "operator_message", runId: "inv-1", branchId: "run", path: [], seq, label: null, ts: new Date().toISOString(), text, mode: "queue", delivered: true,
		});
		const order: string[] = [];
		let resolveHandoff!: () => void;
		const handoffPromise = new Promise<void>((resolve) => {
			resolveHandoff = resolve;
		});
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(join(tmp, "runs", "inv-1", "repo")),
				report: JSON.stringify(report),
			})),
			events: vi.fn(async () => [said("look at checkout", 1), said("not the cache", 2)]),
			resolveHarness: vi.fn(async () => ({
				selection: { runnable: true as const, harness: "codex" as const, auto: false },
				model: "gpt-x",
			})),
			recordHandoff: vi.fn(async () => {
				await handoffPromise;
				order.push("handoff");
			}),
			recordUsage: vi.fn(async () => {
				order.push("usage");
			}),
		});
		mocks.conductRun.mockImplementation(
			async (
				opts: Parameters<typeof conductRun>[0],
				run: Parameters<typeof conductRun>[1],
			) => {
				await run.store.create();
				if (!opts.onSession || !opts.onUsage) throw new Error("expected onSession and onUsage");
				opts.onSession({ sessionId: "s-new", loadSession: true });
				opts.onUsage({ used: 10, size: 100, at: new Date().toISOString() });
				resolveHandoff();
				return { runId: "inv-1", report: null, error: null, failureKind: "none" };
			},
		);

		await runInvestigationJob(
			{ id: "job-2", investigationId: "inv-1", attempts: 1 },
			{ ...data, resume: { ...data.resume!, to: { harness: "codex" }, handoff: true, afterRestart: true } },
			io(),
			ports,
		);

		expect(order).toEqual(["handoff", "usage"]);
		expect(ports.recordHandoff).toHaveBeenCalledWith(
			"inv-1",
			expect.objectContaining({ harness: "codex" }),
		);
		expect(ports.recordUsage).toHaveBeenCalledWith("inv-1", {
			used: 10,
			size: 100,
			at: expect.any(String),
		});
	});
});

describe("a chat run (#673)", () => {
	it("hands the engine the message as a chat and succeeds with no report, never failing the run", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({ runId: "inv-chat", report: null, error: null, failureKind: "none" });
		const ports = fakePorts();

		const result = await runInvestigationJob(
			{ id: "job-chat", investigationId: "inv-chat", attempts: 1 },
			{
				investigationId: "inv-chat",
				incidentId: "inc-chat",
				brief: "never sent",
				kind: "chat",
				chat: { text: "Is the pool still saturated?" },
			},
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ kind?: string; brief?: string }];
		expect(opts).toMatchObject({ kind: "chat", brief: "Is the pool still saturated?" });
		expect(result).toMatchObject({ success: true, investigationId: "inv-chat" });
		expect(result).not.toHaveProperty("error");
		expect(ports.updateStatus).not.toHaveBeenCalledWith("inv-chat", expect.objectContaining({ status: "failed" }));
	});
});


describe("the pre-run fetch reaches the run (#848 ruling 2026-10-24)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(os.tmpdir(), "pl-prerun-run-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tmp, { recursive: true, force: true });
	});
	const io = () => ({ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal });
	const job = (id: string) => [{ id: `job-${id}`, investigationId: id, attempts: 1 }, { investigationId: id, incidentId: "inc-1" }] as const;

	it("starts the run with a skipped source named in its context, stores the snapshot, and copies it into the cwd", async () => {
		const save = vi.fn(async (_id: string, _text: string) => {});
		let copied = false;
		const ports = fakePorts({
			preRun: {
				telemetry: vi.fn(async () => ({
					sources: [
						{ kind: "prometheus" as const, label: "prod prom", from: "set" as const, status: "skipped" as const, reason: "the source did not answer in time" },
						{ kind: "loki" as const, label: "LOKI_URL", from: "env" as const, status: "found" as const, part: { summary: "3 error log lines from 1 streams", data: { result: [] }, count: 3 }, secrets: [] },
					],
					notConfigured: [],
					endpoints: [],
				})),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save,
				load: vi.fn(async () => null),
			},
		});
		mocks.conductRun.mockImplementation(async (o: { cwd: string }) => {
			copied = existsSync(join(o.cwd, ".prismalens", "runs", "inv-pre", "telemetry-loki-1.json"));
			return { failureKind: null, report: { summary: "done", rootCause: null, nextSteps: [] } };
		});

		const result = await runInvestigationJob(...job("inv-pre"), io(), ports);

		expect(result.success).toBe(true);
		const [opts] = mocks.conductRun.mock.calls[0] as [
			{ context: { preRun?: { state: string; copy: { state: string }; sources: unknown[]; files: { name: string }[] } } },
		];
		const pre = opts.context.preRun;
		expect(pre?.state).toBe("ready");
		expect(pre?.copy.state).toBe("written");
		expect(copied).toBe(true);
		expect(pre?.sources).toEqual([
			{ kind: "prometheus", label: "prod prom", from: "set", status: "skipped", detail: "the source did not answer in time" },
			expect.objectContaining({ label: "LOKI_URL", status: "found", file: "telemetry-loki-1.json" }),
		]);
		expect(pre?.files.map((f) => f.name)).toEqual(["telemetry-loki-1.json"]);
		expect(JSON.parse(save.mock.calls[0]?.[1] ?? "{}").files[0].name).toBe("telemetry-loki-1.json");
	});

	it("a telemetry port that throws still starts the run, with nothing fetched", async () => {
		const ports = fakePorts({
			preRun: {
				telemetry: vi.fn(async () => {
					throw new Error("db down");
				}),
				runbooks: vi.fn(async () => {
					throw new Error("git missing");
				}),
				save: vi.fn(async () => {}),
				load: vi.fn(async () => null),
			},
		});

		const result = await runInvestigationJob(...job("inv-pre-err"), io(), ports);

		expect(result.success).toBe(true);
		const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { preRun?: { sources: unknown[]; files: unknown[] } } }];
		expect(opts.context.preRun).toMatchObject({ sources: [], files: [] });
	});

	it("each new investigation fetches afresh", async () => {
		const telemetry = vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] }));
		const ports = fakePorts({
			preRun: { telemetry, runbooks: vi.fn(async () => ({ entries: [] })), save: vi.fn(async () => {}), load: vi.fn(async () => null) },
		});
		await runInvestigationJob(...job("inv-a"), io(), ports);
		await runInvestigationJob(...job("inv-b"), io(), ports);
		expect(telemetry).toHaveBeenCalledTimes(2);
	});

	it("a failed save gives not-saved with copy.written, and the prompt keeps the excerpts and the warning (#848)", async () => {
		const ports = fakePorts({
			preRun: {
				telemetry: vi.fn(async () => ({
					sources: [
						{
							kind: "loki" as const,
							label: "LOKI_URL",
							from: "env" as const,
							status: "found" as const,
							part: { summary: "3 error log lines", data: { result: [] }, count: 3 },
							secrets: [],
						},
					],
					notConfigured: [],
					endpoints: [],
				})),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save: vi.fn(async () => {
					throw new Error("disk full");
				}),
				load: vi.fn(async () => null),
			},
		});

		const result = await runInvestigationJob(...job("inv-save-fail"), io(), ports);

		expect(result.success).toBe(true);
		const [opts] = mocks.conductRun.mock.calls[0] as [
			{ context: { preRun?: { state: string; saveError?: string; copy: { state: string }; sources: unknown[] } } },
		];
		const pre = opts.context.preRun;
		expect(pre?.state).toBe("not-saved");
		expect(pre?.saveError).toBe("disk full");
		expect(pre?.copy.state).toBe("written");
		const { buildInvestigationPrompt } = await import("@prismalens/engine");
		const prompt = buildInvestigationPrompt(opts.context as never);
		expect(prompt).toContain("This snapshot was not saved, so a follow-up on this run will not have it.");
		expect(prompt).toContain("<<<PRE_RUN_TELEMETRY — UNTRUSTED DATA.");
	});

	it("a good save with a failed copy gives ready with copy.failed, and every source line stays (#848)", async () => {
		const cwd = join(tmp, "runs", "inv-copy-fail", "unmapped");
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(cwd, ".prismalens"), "not a directory");

		const ports = fakePorts({
			preRun: {
				telemetry: vi.fn(async () => ({
					sources: [
						{
							kind: "loki" as const,
							label: "LOKI_URL",
							from: "env" as const,
							status: "found" as const,
							part: { summary: "3 error log lines", data: { result: [] }, count: 3 },
							secrets: [],
						},
					],
					notConfigured: [],
					endpoints: [],
				})),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save: vi.fn(async () => {}),
				load: vi.fn(async () => null),
			},
		});

		const result = await runInvestigationJob(...job("inv-copy-fail"), io(), ports);

		expect(result.success).toBe(true);
		const [opts] = mocks.conductRun.mock.calls[0] as [
			{ context: { preRun?: { state: string; copy: { state: string; reason?: string }; sources: unknown[] } } },
		];
		const pre = opts.context.preRun;
		expect(pre?.state).toBe("ready");
		expect(pre?.copy.state).toBe("failed");
		expect(pre?.copy.reason).toContain(".prismalens is not a folder");
		expect(pre?.sources).toEqual([
			expect.objectContaining({ label: "LOKI_URL", status: "found" }),
		]);
		const { buildInvestigationPrompt } = await import("@prismalens/engine");
		const prompt = buildInvestigationPrompt(opts.context as never);
		expect(prompt).not.toContain("Read copies are in");
		expect(prompt).toContain("LOKI_URL (loki): 3 error log lines");
	});

	it("a save that rejects with a message containing a secret calls save twice without the secret (#848)", async () => {
		const secret = "s3cr3t-xyz";
		const save = vi.fn()
			.mockRejectedValueOnce(new Error(`database write failed: ${secret}`))
			.mockResolvedValueOnce(undefined);
		const ports = fakePorts({
			preRun: {
				telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
				runbooks: vi.fn(async () => ({ entries: [] })),
				save,
				load: vi.fn(async () => null),
			},
		});

		const result = await runInvestigationJob(...job("inv-save-secret"), io(), ports);
		expect(result.success).toBe(true);

		await vi.waitFor(() => {
			expect(save).toHaveBeenCalledTimes(2);
		});
		const [, secondRaw] = save.mock.calls[1] as [string, string];
		const secondPayload = JSON.parse(secondRaw);
		expect(secondPayload.state).toBe("not-saved");
		expect(secondPayload.saveError).toBe("the database write failed");
		expect(secondRaw).not.toContain(secret);
	});

	it("a save that never settles still lets conductRun start within 5 s (#848)", async () => {
		vi.useFakeTimers();
		try {
			const neverSettlingSave = new Promise<void>(() => {});
			const save = vi.fn()
				.mockImplementationOnce(() => neverSettlingSave)
				.mockResolvedValueOnce(undefined);
			const ports = fakePorts({
				preRun: {
					telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
					runbooks: vi.fn(async () => ({ entries: [] })),
					save,
					load: vi.fn(async () => null),
				},
			});

			const jobPromise = runInvestigationJob(...job("inv-save-timeout"), io(), ports);
			await vi.advanceTimersByTimeAsync(5_100);
			const result = await jobPromise;

			expect(result.success).toBe(true);
			const [opts] = mocks.conductRun.mock.calls[0] as [
				{ context: { preRun?: { state: string; saveError?: string } } },
			];
			expect(opts.context.preRun?.state).toBe("not-saved");
			expect(opts.context.preRun?.saveError).toBe("the save did not finish in 5 s");
			expect(save).toHaveBeenCalledTimes(2);
			const [, secondRaw] = save.mock.calls[1] as [string, string];
			const secondPayload = JSON.parse(secondRaw);
			expect(secondPayload.saveError).toBe("the save did not finish in 5 s");
		} finally {
			vi.useRealTimers();
		}
	});

	it("a telemetry port that never settles gives a snapshot with telemetrySkipped set and an aborted signal (#848)", async () => {
		vi.useFakeTimers();
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			const ctrl = new AbortController();
			setTimeout(() => ctrl.abort(), ms);
			return ctrl.signal;
		});
		try {
			let passedSignal: AbortSignal | undefined;
			let savedText: string | undefined;
			const neverSettlingTelemetry = new Promise(() => {});
			const ports = fakePorts({
				preRun: {
					telemetry: vi.fn((_id, _w, sig) => {
						passedSignal = sig;
						return neverSettlingTelemetry as never;
					}),
					runbooks: vi.fn(async () => ({ entries: [] })),
					save: vi.fn(async (_id, text) => {
						savedText = text;
					}),
					load: vi.fn(async () => null),
				},
			});

			const jobPromise = runInvestigationJob(...job("inv-telemetry-timeout"), io(), ports);
			await vi.advanceTimersByTimeAsync(15_100);
			const result = await jobPromise;

			expect(result.success).toBe(true);
			expect(passedSignal?.aborted).toBe(true);
			const savedSnapshot = JSON.parse(savedText ?? "{}") as { telemetrySkipped?: string };
			expect(savedSnapshot.telemetrySkipped).toBe(
				"it did not finish in 15 s, or failed",
			);
		} finally {
			timeoutSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it("a findInvestigation that never settles does not block the run past ASSEMBLY_MS (#848)", async () => {
		vi.useFakeTimers();
		try {
			const neverSettlingFind = new Promise<{ status: string }>(() => {});
			const ports = fakePorts({
				findInvestigation: vi.fn(() => neverSettlingFind as never),
			});

			const jobPromise = runInvestigationJob(...job("inv-find-timeout"), io(), ports);
			await vi.advanceTimersByTimeAsync(10_100);
			const result = await jobPromise;

			expect(result.success).toBe(true);
			expect(mocks.conductRun).toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("toolsServer per run and follow-up (#848)", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(os.tmpdir(), "pl-toolsserver-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		const bin = join(tmp, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
		writeFileSync(join(bin, "opencode.cmd"), "@echo off\n");
		vi.stubEnv("PATH", bin);
		mocks.conductRun.mockReset();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tmp, { recursive: true, force: true });
	});

	function findWorkspaceCall(mock: { mock: { calls: unknown[] } }): [string, { workspace?: string }] {
		const call = (mock.mock.calls as [string, { workspace?: string }][]).find(
			([, dto]) => dto?.workspace !== undefined,
		);
		expect(call).toBeDefined();
		if (!call) throw new Error("expected call with workspace");
		return call;
	}

	it("toolsServer: the first run persists toolsServer in workspace JSON and leases with it", async () => {
		const lease = vi.fn(async (_id: string, serverName: string) => ({ serverName }) as never);
		const updateStatus = vi.fn(async () => true);
		const ports = fakePorts({
			updateStatus,
			gateway: { lease, revoke: vi.fn() },
		});
		mocks.conductRun.mockImplementation(async (_o, ioRun: { store: { create(): Promise<void> } }) => {
			await ioRun.store.create();
			return { report: { summary: "done", rootCause: null, nextSteps: [] } };
		});
		await runInvestigationJob(
			{ id: "job-ts-1", investigationId: "inv-ts-1", attempts: 1 },
			{ investigationId: "inv-ts-1", incidentId: "inc-1" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);
		expect(lease).toHaveBeenCalledWith("inv-ts-1", expect.stringMatching(/^prismalens-[a-z2-7]{10}$/));
		const leasedName = lease.mock.calls[0]?.[1];
		const updateCall = findWorkspaceCall(updateStatus);
		const parsed = JSON.parse(updateCall[1].workspace ?? "{}");
		expect(parsed.toolsServer).toBe(leasedName);
	});

	it("toolsServer: a follow-up reuses recorded toolsServer and writes it in rebuilt workspace", async () => {
		const runDir = join(tmp, "runs", "inv-followup");
		mkdirSync(runDir, { recursive: true });
		const lease = vi.fn(async (_id: string, serverName: string) => ({ serverName }) as never);
		const followUpStatus = vi.fn(async () => {});
		const ports = fakePorts({
			gateway: { lease, revoke: vi.fn() },
			followUpStatus,
			findInvestigation: vi.fn(async () => ({
				id: "inv-followup",
				status: "pending",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: JSON.stringify({
					layout: "single",
					cwd: join(runDir, "repo"),
					toolsServer: "prismalens-reused1234",
					repos: [
						{
							name: "repo",
							dir: join(runDir, "repo"),
							sourceKind: "url",
							url: "https://github.com/acme/api",
							subPath: null,
							connectionId: null,
							head: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
							branch: "main",
							services: ["checkout"],
							credential: { source: "none", label: "public", via: "none" },
						},
					],
				}),
			})),
			lastEventSeq: vi.fn(async () => 10),
			snapshotWith: cloneAs(async (_src: unknown, dest: string) => ({
				path: dest,
				head: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
				branch: "main",
			})),
		});

		mocks.conductRun.mockImplementation(
			async (_o, ioRun: { store: { create(): Promise<void>; append(e: CanonicalEvent): Promise<void> } }) => {
				await ioRun.store.create();
				await ioRun.store.append({
					kind: "operator_message",
					runId: "inv-followup",
					branchId: "b",
					path: [],
					ts: "2026-10-11T00:00:00.000Z",
					seq: 42,
					text: "go",
					mode: "queue",
					delivered: true,
				});
				return { runId: "inv-followup", report: null, error: null, failureKind: "none" };
			},
		);

		await runInvestigationJob(
			{ id: "job-followup", investigationId: "inv-followup", attempts: 1 },
			{
				investigationId: "inv-followup",
				incidentId: "inc-followup",
				resume: {
					text: "continue",
					mode: "queue",
					restore: { status: "completed", completedAt: "2026-09-30T10:00:00.000Z", error: null },
				},
			},
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(lease).toHaveBeenCalledWith("inv-followup", "prismalens-reused1234");
		const followUpCall = findWorkspaceCall(followUpStatus);
		const parsed = JSON.parse(followUpCall[1].workspace ?? "{}");
		expect(parsed.toolsServer).toBe("prismalens-reused1234");
	});

	it("toolsServer: a follow-up of a legacy run with no toolsServer leases a fresh name", async () => {
		const runDir = join(tmp, "runs", "inv-legacy");
		mkdirSync(runDir, { recursive: true });
		const lease = vi.fn(async (_id: string, serverName: string) => ({ serverName }) as never);
		const followUpStatus = vi.fn(async () => {});
		const ports = fakePorts({
			gateway: { lease, revoke: vi.fn() },
			followUpStatus,
			findInvestigation: vi.fn(async () => ({
				id: "inv-legacy",
				status: "pending",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: JSON.stringify({
					layout: "single",
					cwd: join(runDir, "repo"),
					repos: [
						{
							name: "repo",
							dir: join(runDir, "repo"),
							sourceKind: "url",
							url: "https://github.com/acme/api",
							subPath: null,
							connectionId: null,
							head: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
							branch: "main",
							services: ["checkout"],
							credential: { source: "none", label: "public", via: "none" },
						},
					],
				}),
			})),
			lastEventSeq: vi.fn(async () => 10),
			snapshotWith: cloneAs(async (_src: unknown, dest: string) => ({
				path: dest,
				head: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
				branch: "main",
			})),
		});

		mocks.conductRun.mockImplementation(
			async (_o, ioRun: { store: { create(): Promise<void>; append(e: CanonicalEvent): Promise<void> } }) => {
				await ioRun.store.create();
				await ioRun.store.append({
					kind: "operator_message",
					runId: "inv-legacy",
					branchId: "b",
					path: [],
					ts: "2026-10-11T00:00:00.000Z",
					seq: 42,
					text: "go",
					mode: "queue",
					delivered: true,
				});
				return { runId: "inv-legacy", report: null, error: null, failureKind: "none" };
			},
		);

		await runInvestigationJob(
			{ id: "job-legacy", investigationId: "inv-legacy", attempts: 1 },
			{
				investigationId: "inv-legacy",
				incidentId: "inc-legacy",
				resume: {
					text: "continue",
					mode: "queue",
					restore: { status: "completed", completedAt: "2026-09-30T10:00:00.000Z", error: null },
				},
			},
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(lease).toHaveBeenCalledWith("inv-legacy", expect.stringMatching(/^prismalens-[a-z2-7]{10}$/));
		const leasedName = lease.mock.calls[0]?.[1];
		const followUpCall = findWorkspaceCall(followUpStatus);
		const parsed = JSON.parse(followUpCall[1].workspace ?? "{}");
		expect(parsed.toolsServer).toBe(leasedName);
	});

	it("persisted and reread harness_tool_call and harness_tools parse with CanonicalEventSchema (#848)", async () => {
		const saved: CanonicalEvent[] = [];
		const ports = fakePorts({
			appendEvents: vi.fn(async (_id: string, events: CanonicalEvent[]) => {
				saved.push(...events);
			}),
		});
		mocks.conductRun.mockReset();
		mocks.conductRun.mockImplementation(
			async (_o, ioRun: { store: { create(): Promise<void>; append(e: CanonicalEvent): Promise<void> } }) => {
				await ioRun.store.create();
				await ioRun.store.append({
					kind: "harness_tool_call",
					runId: "11111111-1111-4111-8111-111111111111",
					branchId: "b",
					path: [],
					ts: "2026-10-24T10:00:00.000Z",
					seq: 1,
					server: "prismalens-abcdefgh23",
					name: "incident_get",
					at: "2026-10-24T10:00:00.000Z",
					turn: "first",
				});
				await ioRun.store.append({
					kind: "harness_tools",
					runId: "11111111-1111-4111-8111-111111111111",
					branchId: "b",
					path: [],
					ts: "2026-10-24T10:00:05.000Z",
					seq: 2,
					server: "prismalens-abcdefgh23",
					turn: "first",
					connected: true,
					calls: [{ name: "incident_get", firstCalledAt: "2026-10-24T10:00:00.000Z", count: 1 }],
				});
				await (ioRun.store as unknown as { finish(r: unknown): Promise<void> }).finish(null);
				return { report: { summary: "done", rootCause: null, nextSteps: [] } };
			},
		);
		const tmpDir = mkdtempSync(join(os.tmpdir(), "pl-events-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmpDir);
		try {
			await runInvestigationJob(
				{ id: "job-events", investigationId: "inv-1", attempts: 1 },
				{ investigationId: "inv-1", incidentId: "inc-1" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);
			expect(saved).toHaveLength(2);
			const reread = JSON.parse(JSON.stringify(saved));
			expect(CanonicalEventSchema.parse(reread[0])).toEqual(saved[0]);
			expect(CanonicalEventSchema.parse(reread[1])).toEqual(saved[1]);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("pre-run deadline and checkout resilience (C3/C3a, #848)", () => {
	function minimalData(overrides: Partial<InvestigationJobData> = {}): InvestigationJobData {
		return { investigationId: "inv-1", incidentId: "inc-1", ...overrides };
	}

	const makeRepo = (url: string, serviceName: string, subPath: string | null = null): IncidentRepo => ({
		sourceKind: "url" as const,
		url,
		connectionId: null,
		defaultBranch: "main" as const,
		subPath,
		serviceName,
	});

	it("checkout budget: 8 repos, one never finishes -> 7 checked out, 1 skipped as budget with signal aborted", async () => {
		vi.useFakeTimers();
		try {
			const tmpDir = mkdtempSync(join(os.tmpdir(), "pl-budget-"));
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmpDir);
			const repoUrls = Array.from({ length: 8 }, (_, i) => `https://github.com/acme/repo-${i}`);
			let abortedSignal: AbortSignal | undefined;

			const ports = fakePorts({
				incidentRepos: vi.fn(async () => repoUrls.map((u, i) => makeRepo(u, `svc-${i}`))),
				snapshotWith: vi.fn(
					async (
						ref: any,
						dest: string,
						signal?: AbortSignal,
					): Promise<{ snap: Snapshot; credential: typeof PUBLIC_CREDENTIAL }> => {
						const url = typeof ref === "string" ? ref : ref.url;
						if (url.endsWith("repo-7")) {
							abortedSignal = signal;
							return new Promise(() => {});
						}
						mkdirSync(dest, { recursive: true });
						return {
							snap: { path: dest, head: "1a2b3c4d5e6f", branch: "main" },
							credential: PUBLIC_CREDENTIAL,
						};
					},
				),
			});

			const wsPromise = resolveWorkspace(minimalData(), ports);
			await vi.advanceTimersByTimeAsync(600_000);
			const ws = await wsPromise;

			expect(ws.repos).toHaveLength(7);
			expect(ws.checkoutsSkipped).toEqual([
				{
					repo: "https://github.com/acme/repo-7",
					code: "budget",
					reason: "the time for checkouts ran out",
				},
			]);
			expect(abortedSignal?.aborted).toBe(true);
			rmSync(tmpDir, { recursive: true, force: true });
		} finally {
			vi.useRealTimers();
			vi.unstubAllEnvs();
		}
	});

	it("checkout guard: 40 repos -> 32 attempted, 8 skipped as guard", async () => {
		const tmpDir = mkdtempSync(join(os.tmpdir(), "pl-guard-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmpDir);
		try {
			const repoUrls = Array.from({ length: 40 }, (_, i) => `https://github.com/acme/repo-${i}`);
			const snapshotWith = vi.fn(async (ref: any, dest: string) => {
				mkdirSync(dest, { recursive: true });
				return {
					snap: { path: dest, head: "1a2b3c4d5e6f", branch: "main" },
					credential: PUBLIC_CREDENTIAL,
				};
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => repoUrls.map((u, i) => makeRepo(u, `svc-${i}`))),
				snapshotWith,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(snapshotWith).toHaveBeenCalledTimes(32);
			expect(ws.repos).toHaveLength(32);
			expect(ws.checkoutsSkipped).toHaveLength(8);
			expect(ws.checkoutsSkipped.every((s) => s.code === "guard" && s.reason === "over the 32-repository guard")).toBe(true);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("checkout failure: primary-only failure has valid cwd, note, report line, and conductRun is called", async () => {
		const tmpDir = mkdtempSync(join(os.tmpdir(), "pl-primary-fail-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmpDir);
		try {
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (opts: { cwd: string }) => {
				expect(existsSync(opts.cwd)).toBe(true);
				return {
					report: { summary: "done", rootCause: null, nextSteps: [], coverage: { queried: [], notQueried: [] } },
				};
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [makeRepo("https://github.com/acme/primary", "checkout")]),
				snapshotWith: vi.fn(async () => {
					throw new Error("clone failed");
				}),
				preRun: {
					telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
					runbooks: vi.fn(async () => ({ entries: [] })),
					save: vi.fn(async () => {}),
					load: vi.fn(async () => null),
				},
			});

			await runInvestigationJob(
				{ id: "job-1", investigationId: "inv-pf", attempts: 1 },
				{ investigationId: "inv-pf", incidentId: "inc-1" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);

			expect(mocks.conductRun).toHaveBeenCalled();
			const [opts] = mocks.conductRun.mock.calls[0] as [{ cwd: string; context: Parameters<typeof withPreRunCoverage>[1] }];
			expect(opts.cwd).toContain("unmapped");
			const [entry] = vi.mocked(ports.createTimelineEntry).mock.calls[0] as [CreateTimelineEntryDto];
			expect(entry.metadata?.mapped).toBe(false);
			expect(entry.description).toContain("Ran without code: no repository could be checked out: URL https://github.com/acme/primary (clone failed).");
			const report = withPreRunCoverage({ coverage: { queried: [], notQueried: [] } }, opts.context);
			expect(report.coverage.notQueried).toContain("Repository https://github.com/acme/primary: not checked out before the run, clone failed");
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("checkout failure: all-checkouts failure has valid cwd, note, report line, and conductRun is called", async () => {
		const tmpDir = mkdtempSync(join(os.tmpdir(), "pl-all-fail-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmpDir);
		try {
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (opts: { cwd: string }) => {
				expect(existsSync(opts.cwd)).toBe(true);
				return {
					report: { summary: "done", rootCause: null, nextSteps: [], coverage: { queried: [], notQueried: [] } },
				};
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					makeRepo("https://github.com/acme/repo-a", "checkout"),
					makeRepo("https://github.com/acme/repo-b", "worker"),
				]),
				snapshotWith: vi.fn(async () => {
					throw new Error("network down");
				}),
				preRun: {
					telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
					runbooks: vi.fn(async () => ({ entries: [] })),
					save: vi.fn(async () => {}),
					load: vi.fn(async () => null),
				},
			});

			await runInvestigationJob(
				{ id: "job-2", investigationId: "inv-af", attempts: 1 },
				{ investigationId: "inv-af", incidentId: "inc-1" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);

			expect(mocks.conductRun).toHaveBeenCalled();
			const [opts] = mocks.conductRun.mock.calls[0] as [{ cwd: string; context: Parameters<typeof withPreRunCoverage>[1] }];
			expect(opts.cwd).toContain("unmapped");
			const [entry] = vi.mocked(ports.createTimelineEntry).mock.calls[0] as [CreateTimelineEntryDto];
			expect(entry.metadata?.mapped).toBe(false);
			expect(entry.description).toContain("Ran without code: no repository could be checked out");
			const report = withPreRunCoverage({ coverage: { queried: [], notQueried: [] } }, opts.context);
			expect(report.coverage.notQueried).toContain("Repository https://github.com/acme/repo-a: not checked out before the run, network down");
			expect(report.coverage.notQueried).toContain("Repository https://github.com/acme/repo-b: not checked out before the run, network down");
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("checkout failure: primary failure with a working secondary promotes secondary, has valid cwd, note, and conductRun called", async () => {
		const tmpDir = mkdtempSync(join(os.tmpdir(), "pl-sec-ok-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmpDir);
		try {
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (opts: { cwd: string }) => {
				expect(existsSync(opts.cwd)).toBe(true);
				return {
					report: { summary: "done", rootCause: null, nextSteps: [], coverage: { queried: [], notQueried: [] } },
				};
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					makeRepo("https://github.com/acme/primary", "checkout"),
					makeRepo("https://github.com/acme/secondary", "worker"),
				]),
				snapshotWith: vi.fn(async (ref: any, dest: string) => {
					const url = typeof ref === "string" ? ref : ref.url;
					if (url.includes("primary")) throw new Error("primary clone error");
					mkdirSync(dest, { recursive: true });
					return {
						snap: { path: dest, head: "1a2b3c4d5e6f", branch: "main" },
						credential: PUBLIC_CREDENTIAL,
					};
				}),
				preRun: {
					telemetry: vi.fn(async () => ({ sources: [], notConfigured: [], endpoints: [] })),
					runbooks: vi.fn(async () => ({ entries: [] })),
					save: vi.fn(async () => {}),
					load: vi.fn(async () => null),
				},
			});

			await runInvestigationJob(
				{ id: "job-3", investigationId: "inv-sec", attempts: 1 },
				{ investigationId: "inv-sec", incidentId: "inc-1" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);

			expect(mocks.conductRun).toHaveBeenCalled();
			const [entry] = vi.mocked(ports.createTimelineEntry).mock.calls[0] as [CreateTimelineEntryDto];
			expect(entry.metadata?.mapped).toBe(true);
			expect(entry.metadata?.repo).toBe("https://github.com/acme/secondary");
			expect(entry.description).toContain("Not included, because it could not be copied: URL https://github.com/acme/primary (primary clone error).");
			const [opts] = mocks.conductRun.mock.calls[0] as [{ cwd: string; context: Parameters<typeof withPreRunCoverage>[1] }];
			const report = withPreRunCoverage({ coverage: { queried: [], notQueried: [] } }, opts.context);
			expect(report.coverage.notQueried).toContain("Repository https://github.com/acme/primary: not checked out before the run, primary clone error");
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	for (const portName of ["getIncident", "contextPack", "incidentRepos"] as const) {
		it(`deadline: non-settling ${portName} still lets conductRun start within its bound plus 1 s`, { timeout: 2000 }, async () => {
			vi.useFakeTimers();
			const tmpDir = mkdtempSync(join(os.tmpdir(), "pl-dl-"));
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmpDir);
			try {
				mocks.conductRun.mockReset();
				mocks.conductRun.mockResolvedValue({
					report: { summary: "done", rootCause: null, nextSteps: [] },
				});
				const ports = fakePorts({
					[portName]: vi.fn(() => new Promise(() => {})),
				});

				const jobPromise = runInvestigationJob(
					{ id: `job-${portName}`, investigationId: "inv-dl", attempts: 1 },
					{ investigationId: "inv-dl", incidentId: "inc-1" },
					{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
					ports,
				);

				await vi.advanceTimersByTimeAsync(11_000);
				await jobPromise;

				expect(mocks.conductRun).toHaveBeenCalled();
				if (portName === "incidentRepos") {
					const [opts] = mocks.conductRun.mock.calls[0] as [{ cwd: string }];
					expect(opts.cwd).toContain("unmapped");
					const [entry] = vi.mocked(ports.createTimelineEntry).mock.calls[0] as [CreateTimelineEntryDto];
					expect(entry.metadata?.mapped).toBe(false);
					expect(entry.description).toContain("the repository list did not load in 10 s");
				}
			} finally {
				vi.useRealTimers();
				vi.unstubAllEnvs();
				rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	}
});
