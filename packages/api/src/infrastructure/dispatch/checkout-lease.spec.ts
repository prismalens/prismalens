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
	});

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
		expect(observeWorkspace([{ name: "repo", dir, head: git(dir, "rev-parse", "HEAD") }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "unchecked" })]);
		expect(existsSync(marker)).toBe(false);
	}, 30_000);

	it("global CRLF normalization remains effective in admission and restart observations", async () => {
		const home = join(env.root, "global-config");
		mkdirSync(home);
		const config = join(home, "gitconfig");
		writeFileSync(config, "[core]\n autocrlf = true\n");
		vi.stubEnv("GIT_CONFIG_GLOBAL", config);
		try {
			const dir = repo("global-crlf");
			const file = join(dir, "packages", "api", "a.txt");
			rmSync(file);
			git(dir, "checkout", "--", "packages/api/a.txt");
			expect(readFileSync(file, "utf8")).toBe("a\r\n");
			expect(git(dir, "status", "--porcelain")).toBe("");
			utimesSync(file, new Date(1), new Date(1));
			const index = readFileSync(join(dir, ".git", "index"));
			expect((await lease.checkoutState(dir)).dirty).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
			const { observeWorkspace } = await import("./investigation-run.js");
			expect(observeWorkspace([{ name: "repo", dir, head: git(dir, "rev-parse", "HEAD") }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "as-was" })]);
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
		expect(observeWorkspace([{ name: "repo", dir, head: state.head }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "as-was" })]);
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
		expect(observeWorkspace([{ name: "repo", dir, head: state.head }], new Map([[dir, true]]))).toEqual([expect.objectContaining({ state: "unchecked" })]);
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

	it("rechecks live status under the writer lock before containing a receipt", async () => {
		const run = await thread("running");
		const dir = repo("readmitted");
		await lease.takeLease(prisma as never, dir, run.id);
		const gone = vi.fn(async () => true);
		expect(await lease.releaseIfGone(prisma as never, gone, dir)).toBe(0);
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
		expect(await lease.releaseIfGone(prisma as never, async () => false, shop)).toBe(0);
		expect(await lease.checkoutBusy(prisma as never, shop, second.id)).toBe(true);
		expect(await lease.releaseIfGone(prisma as never, async () => true, shop)).toBe(1);
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
		expect(released).toBeGreaterThanOrEqual(1);
		expect(await lease.leasedBy(prisma, ended.id)).toBeNull();
		// A restart that could not prove the agent gone keeps its checkout blocked.
		expect(await lease.leasedBy(prisma, running.id)).toBe(stillRunning);
		const next = await thread("pending");
		expect(await lease.checkoutBusy(prisma as never, stillRunning, next.id)).toBe(true);
		expect(await lease.leasedBy(prisma, live.id)).toBe(kept);
		expect(asked).not.toContain(live.id);
	});

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
	});

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
});
