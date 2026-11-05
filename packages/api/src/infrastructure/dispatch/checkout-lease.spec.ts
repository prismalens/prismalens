// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The borrowed checkout (#1024): one lease per canonical working tree, over a temp SQLite
 * database and real git repositories, and only read-only git ever runs on it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

	it("a second live thread is refused, on the checkout or a folder nested in it, until the first ends", async () => {
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
		expect(await lease.checkoutBusy(prisma as never, shop, second.id)).toBe(false);
		await lease.takeLease(prisma as never, shop, second.id);
		expect(await lease.leasedBy(prisma, second.id)).toBe(shop);
		expect(await prisma.checkoutLease.count()).toBe(1);
	});

	it("at boot, a lease whose run is no longer live is released and a live one is kept", async () => {
		const ended = await thread("failed");
		const live = await thread("pending");
		const other = repo("other");
		await lease.takeLease(prisma as never, other, ended.id);
		const kept = repo("kept");
		await lease.takeLease(prisma as never, kept, live.id);
		const released = await lease.releaseEndedLeases(prisma);
		expect(released).toBeGreaterThanOrEqual(1);
		expect(await lease.leasedBy(prisma, ended.id)).toBeNull();
		expect(await lease.leasedBy(prisma, live.id)).toBe(kept);
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
			seen.push(args);
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
