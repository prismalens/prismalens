// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The borrowed checkout (#1024): one lease per canonical working tree, over a temp SQLite
 * database and real git repositories, and only read-only git ever runs on it.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "pl-lease-")),
	);
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const lease = await import("./checkout-lease.js");
const { folderBusy, holdConversion } = await import("./folder-lock.js");

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo(name: string): string {
	const dir = join(env.root, name);
	mkdirSync(join(dir, "packages", "api"), { recursive: true });
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "t@example.com");
	git(dir, "config", "user.name", "t");
	writeFileSync(join(dir, "packages", "api", "a.txt"), "a\n");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "first");
	return dir;
}

describe("checkout leases (#1024)", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let shop: string;

	async function thread(status: string, repositoryId?: string) {
		return prisma.investigation.create({
			data: { status, kind: "chat", ...(repositoryId ? { repositoryId } : {}) },
		});
	}

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import(
			"@prismalens/database/migrator"
		);
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		shop = repo("shop");
	});

	afterAll(async () => {
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	it("a nested folder resolves to its checkout's top level, as the disk names it", async () => {
		const root = await lease.checkoutRoot(join(shop, "packages", "api"));
		expect(root).not.toBeNull();
		expect(lease.sameCheckout(root as string, shop)).toBe(true);
		expect(await lease.checkoutRoot(join(env.root, "nowhere"))).toBeNull();
	});

	it("a checkout git cannot read right now is unreadable, not gone; one git says is not a work tree is gone", async () => {
		const { GitMissingError, GitSpawnError } = await import(
			"../../core/harness/git-spawn.js"
		);
		const failWith = (e: Error) => lease.setCheckoutGit(async () => Promise.reject(e));
		try {
			failWith(new GitSpawnError("git rev-parse timed out", null, "", true));
			await expect(lease.checkoutRoot(shop)).rejects.toThrow(
				lease.CheckoutUnreadable,
			);
			failWith(new GitMissingError());
			await expect(lease.checkoutRoot(shop)).rejects.toThrow(/Git isn't installed/);
			failWith(new GitSpawnError("git rev-parse failed (exit 128)", 128, "not a git repository", false));
			expect(await lease.checkoutRoot(shop)).toBeNull();
		} finally {
			lease.setCheckoutGit(null);
		}
	});

	it("a folder git named but the disk would not resolve in time is unreadable, not gone", async () => {
		lease.setCheckoutGit(async () => ({ stdout: `${shop}
`, stderr: "" }));
		const canonical = vi
			.spyOn(await import("./folder-lock.js"), "canonical")
			.mockResolvedValueOnce(null);
		try {
			await expect(lease.checkoutRoot(shop)).rejects.toThrow(lease.CheckoutUnreadable);
		} finally {
			canonical.mockRestore();
			lease.setCheckoutGit(null);
		}
	});

	it("a busy folder reader is unreadable too, not gone", async () => {
		const { CanonicalBusy } = await import("./folder-lock.js");
		lease.setCheckoutGit(async () => ({ stdout: `${shop}\n`, stderr: "" }));
		const canonical = vi
			.spyOn(await import("./folder-lock.js"), "canonical")
			.mockRejectedValueOnce(new CanonicalBusy());
		try {
			await expect(lease.checkoutRoot(shop)).rejects.toThrow(
				lease.CheckoutUnreadable,
			);
		} finally {
			canonical.mockRestore();
			lease.setCheckoutGit(null);
		}
	});

	it("a status never runs an fsmonitor hook the checkout's own config names", async () => {
		const dir = repo("hooked");
		const marker = join(env.root, "hook-ran");
		const hook = join(env.root, "hook.sh").replaceAll("\\", "/");
		writeFileSync(
			hook,
			`#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\nprintf '/'\n`,
			{ mode: 0o755 },
		);
		git(dir, "config", "core.fsmonitor", hook);
		// The control: git's own status runs the hook, so the guard below is what stops it.
		git(dir, "status", "--porcelain");
		expect(existsSync(marker)).toBe(true);
		rmSync(marker);
		await lease.checkoutState(dir);
		await lease.checkoutRoot(dir);
		expect(existsSync(marker)).toBe(false);
	}, 30_000);

	it("admission and restart status never run a clean filter, and mark its unstaged count unknown", async () => {
		const dir = repo("filtered");
		const marker = join(env.root, "filter-ran");
		const hook = join(env.root, "filter.sh").replaceAll("\\", "/");
		writeFileSync(hook, `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\ncat\n`, { mode: 0o755 });
		writeFileSync(join(dir, ".gitattributes"), "*.txt filter=marker\n");
		git(dir, "config", "filter.marker.clean", hook);
		git(dir, "add", ".");
		git(dir, "commit", "-qm", "filter");
		rmSync(marker, { force: true });
		const file = join(dir, "packages", "api", "a.txt");
		utimesSync(file, new Date(1), new Date(1));
		git(dir, "status", "--porcelain");
		expect(existsSync(marker)).toBe(true);
		rmSync(marker);
		writeFileSync(file, "changed\n");
		writeFileSync(join(dir, "staged.txt"), "staged\n");
		git(dir, "add", "staged.txt");
		rmSync(marker, { force: true });
		writeFileSync(join(dir, "untracked.txt"), "new\n");
		expect((await lease.checkoutState(dir)).dirty).toEqual({ staged: 1, unstaged: null, untracked: 1 });
		const { observeWorkspace } = await import("./investigation-run.js");
		expect(await observeWorkspace([{ name: "repo", dir, head: git(dir, "rev-parse", "HEAD") }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "unchecked" })]);
		expect(existsSync(marker)).toBe(false);
	}, 30_000);

	it("global CRLF normalization remains effective in admission and restart observations", async () => {
		const home = join(env.root, "global-config");
		mkdirSync(home);
		const config = join(home, "gitconfig");
		const ignore = join(home, "ignore");
		writeFileSync(ignore, "ignored.txt\n");
		writeFileSync(config, `[core]\n autocrlf = true\n excludesFile = ${JSON.stringify(ignore.replaceAll("\\", "/"))}\n`);
		vi.stubEnv("GIT_CONFIG_GLOBAL", config);
		try {
			const dir = repo("global-crlf");
			writeFileSync(join(dir, "ignored.txt"), "ignored\n");
			const file = join(dir, "packages", "api", "a.txt");
			rmSync(file);
			git(dir, "checkout", "--", "packages/api/a.txt");
			expect(readFileSync(file, "utf8")).toBe("a\r\n");
			expect(git(dir, "status", "--porcelain")).toBe("");
			utimesSync(file, new Date(1), new Date(1));
			const index = readFileSync(join(dir, ".git", "index"));
			expect((await lease.checkoutState(dir)).dirty).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
			const { observeWorkspace } = await import("./investigation-run.js");
			expect(await observeWorkspace([{ name: "repo", dir, head: git(dir, "rev-parse", "HEAD") }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "as-was" })]);
			expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
		} finally { vi.unstubAllEnvs(); }
	}, 30_000);

	it("SHA-256 checkouts can be observed without changing their index", async () => {
		const dir = join(env.root, "sha256");
		mkdirSync(dir);
		git(dir, "init", "-q", "--object-format=sha256");
		git(dir, "config", "user.email", "t@example.com");
		git(dir, "config", "user.name", "t");
		writeFileSync(join(dir, "file.txt"), "a\n");
		git(dir, "add", ".");
		git(dir, "commit", "-qm", "first");
		const index = readFileSync(join(dir, ".git", "index"));
		const state = await lease.checkoutState(dir);
		expect(state.head).toHaveLength(64);
		expect(state.dirty).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
		const { observeWorkspace } = await import("./investigation-run.js");
		expect(await observeWorkspace([{ name: "repo", dir, head: state.head }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "as-was" })]);
		expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
	}, 30_000);

	it.each(["upper", "set", "unset", "unspecified"])("a transforming filter named %s yields unknown changes without executing it", async (driver) => {
		const dir = repo(`transform-filter-${driver}`);
		const marker = join(env.root, "transform-ran");
		const script = join(env.root, "transform.sh").replaceAll("\\", "/");
		writeFileSync(script, `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\ntr a-z A-Z\n`, { mode: 0o755 });
		writeFileSync(join(dir, ".gitattributes"), `*.txt filter=${driver}\n`);
		git(dir, "config", `filter.${driver}.clean`, script);
		git(dir, "add", ".");
		// a.txt was committed before the filter existed; a plain add re-cleans it only when its stat looks racy.
		git(dir, "add", "--renormalize", ".");
		git(dir, "commit", "-qm", "filter");
		const file = join(dir, "packages", "api", "a.txt");
		utimesSync(file, new Date(1), new Date(1));
		expect(git(dir, "status", "--porcelain")).toBe("");
		expect(existsSync(marker)).toBe(true);
		rmSync(marker);
		utimesSync(file, new Date(2), new Date(2));
		const index = readFileSync(join(dir, ".git", "index"));
		const state = await lease.checkoutState(dir);
		expect(state.dirty).toEqual({ staged: 0, unstaged: null, untracked: 0 });
		const { observeWorkspace } = await import("./investigation-run.js");
		expect(await observeWorkspace([{ name: "repo", dir, head: state.head }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "unchecked" })]);
		expect(existsSync(marker)).toBe(false);
		expect(readFileSync(join(dir, ".git", "index"))).toEqual(index);
	}, 30_000);

	it.each([false, true])("a stale snapshot cannot contain a newer lease, including recreation=%s", async (recreated) => {
		const run = await thread("failed");
		const dir = repo(`generation-${recreated}`);
		await lease.takeLease(prisma as never, dir, run.id);
		const old = await prisma.checkoutLease.findUniqueOrThrow({ where: { canonicalPath: dir } });
		if (recreated) await lease.releaseLease(prisma, run.id);
		await lease.takeLease(prisma as never, dir, run.id);
		await prisma.checkoutLease.update({ where: { canonicalPath: dir }, data: { takenAt: old.takenAt } });
		const gone = vi.fn(async () => true);
		const snapshot = vi.spyOn(prisma.checkoutLease, "findMany").mockResolvedValueOnce([old]);
		try { await lease.releaseIfGone(prisma as never, gone, dir); } finally { snapshot.mockRestore(); }
		expect(gone).not.toHaveBeenCalled();
		expect(await lease.leasedBy(prisma, run.id)).toBe(dir);
		await lease.releaseLease(prisma, run.id);
	});

	it("a containment cut off at its limit keeps the lease and loses no write made meanwhile", async () => {
		const run = await thread("failed");
		const dir = repo("slow-containment");
		await lease.takeLease(prisma as never, dir, run.id);
		const key = `slow-containment-${run.id}`;
		let wrote: Promise<unknown> = Promise.resolve();
		let started = false;
		const gone = vi.fn(async (_id: string, _session: string | null, signal?: AbortSignal) => {
			// A write from elsewhere lands while containment holds the lease transaction open.
			// then() starts the query now; a bare Prisma query waits until it is awaited.
			wrote = prisma.setting.create({ data: { key, value: '"x"' } }).then(() => undefined);
			started = true;
			await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
			return false;
		});
		expect(await lease.releaseIfGone(prisma as never, gone, dir, new Date(), 200)).toEqual({
			released: 0,
			failed: 1,
		});
		expect(started).toBe(true);
		await wrote;
		expect(await lease.leasedBy(prisma, run.id)).toBe(dir);
		expect((await prisma.setting.findUnique({ where: { key } }))?.value).toBe('"x"');
		await prisma.setting.delete({ where: { key } });
		await lease.releaseLease(prisma, run.id);
	});

	it("rechecks live status under the writer lock before containing a receipt", async () => {
		const run = await thread("running");
		const dir = repo("readmitted");
		await lease.takeLease(prisma as never, dir, run.id);
		const gone = vi.fn(async () => true);
		expect(await lease.releaseIfGone(prisma as never, gone, dir)).toEqual({ released: 0, failed: 0 });
		expect(gone).not.toHaveBeenCalled();
		expect(await lease.leasedBy(prisma, run.id)).toBe(dir);
		await lease.releaseLease(prisma, run.id);
	});

	it("an alias through a symlink or junction is the same checkout", async () => {
		const alias = join(env.root, "shop-alias");
		try {
			symlinkSync(shop, alias, "junction");
		} catch {
			return; // links not permitted here
		}
		const root = await lease.checkoutRoot(join(alias, "packages"));
		expect(lease.sameCheckout(root as string, shop)).toBe(true);
	});

	it.runIf(process.platform === "win32" || process.platform === "darwin")(
		"letter case folds where the disk does",
		() => {
			expect(lease.sameCheckout(shop.toUpperCase(), shop)).toBe(true);
		},
	);

	it("a second thread is refused, on the checkout or a folder nested in it, until the first's agent is gone", async () => {
		const first = await thread("running");
		const second = await thread("pending");
		await lease.takeLease(prisma as never, shop, first.id);
		expect(await lease.checkoutBusy(prisma as never, shop, second.id)).toBe(true);
		expect(
			await lease.checkoutBusy(prisma as never, join(shop, "packages", "api"), second.id),
		).toBe(true);
		// Its own lease never refuses it: a follow-up takes the checkout again.
		expect(await lease.checkoutBusy(prisma as never, shop, first.id)).toBe(false);
		expect(await lease.leasedBy(prisma, first.id)).toBe(shop);

		await prisma.investigation.update({
			where: { id: first.id },
			data: { status: "completed" },
		});
		// An ended run still holds the checkout until its agent is proven gone.
		expect(await lease.checkoutBusy(prisma as never, shop, second.id)).toBe(true);
		expect(await lease.releaseIfGone(prisma as never, async () => false, shop)).toEqual({ released: 0, failed: 0 });
		expect(await lease.checkoutBusy(prisma as never, shop, second.id)).toBe(true);
		expect(await lease.releaseIfGone(prisma as never, async () => true, shop)).toEqual({ released: 1, failed: 0 });
		expect(await lease.checkoutBusy(prisma as never, shop, second.id)).toBe(false);
		await lease.takeLease(prisma as never, shop, second.id);
		expect(await lease.leasedBy(prisma, second.id)).toBe(shop);
		expect(await prisma.checkoutLease.count()).toBe(1);
	});

	it("at boot, a lease is released only once its run ended and its agent is proven gone", async () => {
		const ended = await thread("failed");
		const running = await thread("failed");
		const live = await thread("pending");
		await lease.takeLease(prisma as never, repo("other"), ended.id);
		const stillRunning = repo("still-running");
		await lease.takeLease(prisma as never, stillRunning, running.id);
		const kept = repo("kept");
		await lease.takeLease(prisma as never, kept, live.id);
		const asked: string[] = [];
		const released = await lease.releaseIfGone(prisma as never, async (id) => {
			asked.push(id);
			return id === ended.id;
		});
		expect(released.released).toBeGreaterThanOrEqual(1);
		expect(await lease.leasedBy(prisma, ended.id)).toBeNull();
		// A restart that could not prove the agent gone keeps its checkout blocked.
		expect(await lease.leasedBy(prisma, running.id)).toBe(stillRunning);
		const next = await thread("pending");
		expect(await lease.checkoutBusy(prisma as never, stillRunning, next.id)).toBe(true);
		expect(await lease.leasedBy(prisma, live.id)).toBe(kept);
		expect(asked).not.toContain(live.id);
	}, 30_000);

	it("the run's end releases its lease", async () => {
		const run = await thread("running");
		const dir = repo("ends");
		await lease.takeLease(prisma as never, dir, run.id);
		await lease.releaseLease(prisma as never, run.id);
		expect(await lease.leasedBy(prisma, run.id)).toBeNull();
	});

	it("two services whose projects sit in one checkout share its single lease", async () => {
		const mono = repo("mono");
		mkdirSync(join(mono, "services", "billing"), { recursive: true });
		const api = await lease.checkoutRoot(join(mono, "packages", "api"));
		const billing = await lease.checkoutRoot(join(mono, "services", "billing"));
		expect(api).not.toBeNull();
		expect(api).toBe(billing);
		const first = await thread("running");
		const second = await thread("pending");
		await lease.takeLease(prisma as never, api as string, first.id);
		expect(await lease.checkoutBusy(prisma as never, billing as string, second.id)).toBe(true);
	});

	it("a plain folder's run and a checkout lease nested with it refuse each other", async () => {
		const parent = join(env.root, "code");
		const inner = join(parent, "app");
		mkdirSync(inner, { recursive: true });
		const project = await prisma.repository.create({
			data: { fullName: "code", url: parent, sourceKind: "folder", plain: true },
		});
		const holder = await thread("running");
		await lease.takeLease(prisma as never, inner, holder.id);
		const plainRun = await thread("pending", project.id);
		expect(await folderBusy(prisma as never, project.id, plainRun.id)).toBe(true);
		await prisma.investigation.update({
			where: { id: holder.id },
			data: { status: "completed" },
		});
		expect(await folderBusy(prisma as never, project.id, plainRun.id)).toBe(true);
		await lease.releaseLease(prisma as never, holder.id);
		expect(await folderBusy(prisma as never, project.id, plainRun.id)).toBe(false);
		await prisma.investigation.update({
			where: { id: plainRun.id },
			data: { status: "running" },
		});
		const next = await thread("pending");
		expect(await lease.checkoutBusy(prisma as never, inner, next.id)).toBe(true);
		await prisma.investigation.update({
			where: { id: plainRun.id },
			data: { status: "completed" },
		});
		const release = holdConversion(parent);
		try {
			expect(await lease.checkoutBusy(prisma as never, inner, next.id)).toBe(true);
		} finally {
			release();
		}
		expect(await lease.checkoutBusy(prisma as never, inner, next.id)).toBe(false);
	});

	it("records HEAD, the branch and counts of changes, never their names or contents", async () => {
		const dir = repo("dirty");
		writeFileSync(join(dir, "packages", "api", "a.txt"), "changed\n");
		writeFileSync(join(dir, "staged.txt"), "s\n");
		git(dir, "add", "staged.txt");
		writeFileSync(join(dir, "new.txt"), "n\n");
		const state = await lease.checkoutState(dir);
		expect(state).toEqual({
			path: dir,
			head: git(dir, "rev-parse", "HEAD"),
			branch: "main",
			dirty: { staged: 1, unstaged: 1, untracked: 1 },
		});
		expect(JSON.stringify(state)).not.toContain("new.txt");
		git(dir, "checkout", "-q", "--detach");
		expect((await lease.checkoutState(dir)).branch).toBeNull();
	}, 30_000);

	it("counts each porcelain v2 entry kind", () => {
		expect(
			lease.dirtyCounts(
				[
					"1 M. N... 100644 100644 100644 a b f1",
					"1 .M N... 100644 100644 100644 a b f2",
					"1 MM N... 100644 100644 100644 a b f3",
					"2 R. N... 100644 100644 100644 a b R100 f4\tf5",
					"u UU N... 100644 100644 100644 100644 a b c f6",
					"? f7",
					"! ignored",
					"",
				].join("\n"),
			),
		).toEqual({ staged: 3, unstaged: 3, untracked: 1 });
	});

	it("no git call that writes ever reaches a borrowed checkout", async () => {
		const seen: string[][] = [];
		lease.setCheckoutGit(async (args, opts) => {
			seen.push(args.slice(lease.NO_FSMONITOR.length));
			const { spawnGit } = await import("../../core/harness/git-spawn.js");
			return spawnGit(args, opts);
		});
		try {
			for (const sub of [
				["reset", "--hard"],
				["checkout", "."],
				["clean", "-fdx"],
				["stash"],
				["worktree", "remove", shop],
				["branch", "-D", "main"],
				[],
			])
				await expect(lease.checkoutGit(sub, shop)).rejects.toThrow(
					/never runs on a borrowed checkout/,
				);
			await lease.checkoutState(shop);
			await lease.checkoutRoot(shop);
		} finally {
			lease.setCheckoutGit(null);
		}
		expect(seen.map((a) => a[0])).toEqual([
			"rev-parse",
			"symbolic-ref",
			"status",
			"rev-parse",
		]);
		expect(git(shop, "stash", "list")).toBe("");
	});

	describe("stale leases and busy reason with fake store (#1066)", () => {
		function fakeStore(opts: {
			leases: Array<{
				canonicalPath: string;
				investigationId: string;
				generation: number;
				takenAt: Date;
			}>;
			runs: Array<{
				id: string;
				status: string;
				acpSessionId?: string | null;
				completedAt?: Date | null;
			}>;
			failOnId?: string;
		}) {
			const leases = opts.leases.map((l) => ({ ...l }));
			const runs = opts.runs.map((r) => ({ ...r }));

			const client = {
				checkoutLease: {
					findMany: async (args?: {
						where?: { investigationId?: { not?: string } };
					}) => {
						const notId = args?.where?.investigationId?.not;
						return (
							notId
								? leases.filter((l) => l.investigationId !== notId)
								: leases
						).map((l) => ({ ...l }));
					},
					updateMany: async ({
						where,
					}: {
						where: {
							canonicalPath: string;
							investigationId: string;
							generation: number;
						};
					}) => {
						if (opts.failOnId && where.investigationId === opts.failOnId) {
							throw new Error("transaction failed");
						}
						const found = leases.some(
							(l) =>
								l.canonicalPath === where.canonicalPath &&
								l.investigationId === where.investigationId &&
								l.generation === where.generation,
						);
						return { count: found ? 1 : 0 };
					},
					deleteMany: async ({
						where,
					}: {
						where: {
							canonicalPath: string;
							investigationId: string;
							generation: number;
						};
					}) => {
						const idx = leases.findIndex(
							(l) =>
								l.canonicalPath === where.canonicalPath &&
								l.investigationId === where.investigationId &&
								l.generation === where.generation,
						);
						if (idx >= 0) {
							leases.splice(idx, 1);
							return { count: 1 };
						}
						return { count: 0 };
					},
				},
				investigation: {
					findUnique: async ({ where }: { where: { id: string } }) => {
						const r = runs.find((run) => run.id === where.id);
						return r
							? {
									status: r.status,
									acpSessionId: r.acpSessionId ?? null,
									completedAt: r.completedAt ?? null,
								}
							: null;
					},
					findMany: async ({
						where,
					}: {
						where: { id: { in: string[] } };
					}) => {
						return runs
							.filter((r) => where.id.in.includes(r.id))
							.map((r) => ({ status: r.status }));
					},
				},
			};

			return {
				...client,
				leases,
				$transaction: async <T>(fn: (tx: typeof client) => Promise<T>): Promise<T> => {
					return fn(client);
				},
			};
		}

		it("keeps the lease, aborts containment and counts it failed when it outlasts CONTAINMENT_TIMEOUT_MS", async () => {
			vi.useFakeTimers();
			try {
				const now = new Date("2026-11-10T12:00:00.000Z");
				const store = fakeStore({
					leases: [
						{ canonicalPath: shop, investigationId: "slow-run", generation: 1, takenAt: now },
					],
					runs: [{ id: "slow-run", status: "completed", completedAt: now }],
				});
				const signals: AbortSignal[] = [];
				const gone = vi.fn(
					(_id: string, _session: string | null, signal?: AbortSignal) => {
						if (signal) signals.push(signal);
						return new Promise<boolean>(() => {});
					},
				);
				const result = lease.releaseIfGone(store as never, gone, null, now);
				await vi.advanceTimersByTimeAsync(lease.CONTAINMENT_TIMEOUT_MS);
				expect(await result).toEqual({ released: 0, failed: 1 });
				expect(signals.map((s) => s.aborted)).toEqual([true]);
				expect(store.leases).toHaveLength(1);
			} finally {
				vi.useRealTimers();
			}
		});

		it("keeps an ended run's lease when ended under an hour before now, and loses it at STALE_LEASE_MS or later", async () => {
			const now = new Date("2026-11-10T12:00:00.000Z");
			const recentStore = fakeStore({
				leases: [
					{
						canonicalPath: shop,
						investigationId: "recent-run",
						generation: 1,
						takenAt: new Date(now.getTime() - 59 * 60 * 1000),
					},
				],
				runs: [
					{
						id: "recent-run",
						status: "completed",
						completedAt: new Date(now.getTime() - 59 * 60 * 1000),
					},
				],
			});
			const gone = vi.fn(async () => false);
			expect(
				await lease.releaseIfGone(recentStore as never, gone, null, now),
			).toEqual({ released: 0, failed: 0 });
			expect(recentStore.leases).toHaveLength(1);

			const staleStore = fakeStore({
				leases: [
					{
						canonicalPath: shop,
						investigationId: "stale-run",
						generation: 1,
						takenAt: new Date(now.getTime() - lease.STALE_LEASE_MS),
					},
				],
				runs: [
					{
						id: "stale-run",
						status: "completed",
						completedAt: new Date(now.getTime() - lease.STALE_LEASE_MS),
					},
				],
			});
			expect(
				await lease.releaseIfGone(staleStore as never, gone, null, now),
			).toEqual({ released: 1, failed: 0 });
			expect(staleStore.leases).toHaveLength(0);

			const olderStore = fakeStore({
				leases: [
					{
						canonicalPath: shop,
						investigationId: "older-run",
						generation: 1,
						takenAt: new Date(now.getTime() - lease.STALE_LEASE_MS - 60_000),
					},
				],
				runs: [
					{
						id: "older-run",
						status: "completed",
						completedAt: new Date(now.getTime() - lease.STALE_LEASE_MS - 60_000),
					},
				],
			});
			expect(
				await lease.releaseIfGone(olderStore as never, gone, null, now),
			).toEqual({ released: 1, failed: 0 });
			expect(olderStore.leases).toHaveLength(0);
		});

		it("a row whose transaction throws gives { failed: 1 } while another row is still released", async () => {
			const store = fakeStore({
				leases: [
					{
						canonicalPath: join(env.root, "repo-fail"),
						investigationId: "run-fail",
						generation: 1,
						takenAt: new Date(),
					},
					{
						canonicalPath: join(env.root, "repo-ok"),
						investigationId: "run-ok",
						generation: 1,
						takenAt: new Date(),
					},
				],
				runs: [
					{ id: "run-fail", status: "completed" },
					{ id: "run-ok", status: "completed" },
				],
				failOnId: "run-fail",
			});
			const result = await lease.releaseIfGone(
				store as never,
				async () => true,
			);
			expect(result).toEqual({ released: 1, failed: 1 });
			expect(store.leases.map((l) => l.investigationId)).toEqual(["run-fail"]);
		});

		it("busyReason gives CHECKOUT_HELD_BY_ENDED when only ended runs hold the path and CHECKOUT_BUSY when a live run does", async () => {
			const endedStore = fakeStore({
				leases: [
					{
						canonicalPath: shop,
						investigationId: "ended-1",
						generation: 1,
						takenAt: new Date(),
					},
				],
				runs: [{ id: "ended-1", status: "completed" }],
			});
			expect(await lease.busyReason(endedStore as never, shop)).toBe(
				lease.CHECKOUT_HELD_BY_ENDED,
			);

			const liveStore = fakeStore({
				leases: [
					{
						canonicalPath: shop,
						investigationId: "live-1",
						generation: 1,
						takenAt: new Date(),
					},
				],
				runs: [{ id: "live-1", status: "running" }],
			});
			expect(await lease.busyReason(liveStore as never, shop)).toBe(
				lease.CHECKOUT_BUSY,
			);
		});
	});
});
