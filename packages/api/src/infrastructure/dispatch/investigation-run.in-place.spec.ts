// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Only a person's project thread borrows the user's checkout, and a follow-up never rebuilds it (#1024). */
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvestigationJobData } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pl-inplace-")));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { personStarted, rebuildWorkspace, resolveWorkspace, logBorrowed } = await import(
	"./investigation-run.js"
);

const checkout = join(env.root, "shop");
const git = (...args: string[]) =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
		cwd: checkout,
		encoding: "utf8",
	}).trim();

const repo = {
	sourceKind: "folder" as const,
	url: checkout,
	defaultBranch: "main",
	subPath: "web",
	connectionId: null,
	serviceName: "shop",
};
const job = (over: Partial<InvestigationJobData> = {}): InvestigationJobData =>
	({
		incidentId: null,
		investigationId: "11111111-1111-4111-8111-111111111111",
		startedBy: "person",
		thread: {
			subject: "project",
			repositoryId: "r1",
			serviceId: null,
			name: "shop",
			repos: [repo],
			checkout,
		},
		...over,
	}) as InvestigationJobData;
const ports = {
	snapshotWith: vi.fn(async () => {
		throw new Error("no snapshot in this test");
	}),
} as never;

beforeAll(() => {
	mkdirSync(join(checkout, "web"), { recursive: true });
	writeFileSync(join(checkout, "web", "a.txt"), "a\n");
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	writeFileSync(join(checkout, "web", "a.txt"), "edited\n");
});
afterAll(() => rmSync(env.root, { recursive: true, force: true }));

describe("in-place runs on a git checkout (#1024)", () => {
	it("only a thread a person started on its project counts as theirs", () => {
		expect(personStarted(job())).toBe(true);
		expect(personStarted(job({ incidentId: "i1" }))).toBe(false);
		expect(personStarted(job({ unattended: true }))).toBe(false);
		expect(personStarted(job({ startedBy: "alert" }))).toBe(false);
		expect(personStarted(job({ startedBy: "schedule" }))).toBe(false);
		expect(
			personStarted(
				job({ scheduled: { subject: "project" } as InvestigationJobData["scheduled"] }),
			),
		).toBe(false);
		expect(
			personStarted(
				job({ thread: { ...job().thread, subject: "service" } as InvestigationJobData["thread"] }),
			),
		).toBe(false);
	});

	it("a person's thread works in the checkout's sub-path, with its state recorded before the first turn", async () => {
		const ws = await resolveWorkspace(job(), ports);
		expect(ws.layout).toBe("in_place");
		expect(ws.cwd).toBe(join(checkout, "web"));
		expect(ws.borrowed).toEqual({
			path: checkout,
			head: git("rev-parse", "HEAD"),
			branch: "main",
			dirty: { staged: 0, unstaged: 1, untracked: 0 },
		});
		expect(ws.note).toContain("cannot undo");
	});

	it("never in place for an unattended run, even with a checkout on the job; it gets a snapshot", async () => {
		const ws = await resolveWorkspace(job({ unattended: true }), ports);
		expect(ws.layout).not.toBe("in_place");
		expect((ports as { snapshotWith: ReturnType<typeof vi.fn> }).snapshotWith).toHaveBeenCalled();
	});

	it("a URL project never borrows a checkout", async () => {
		const url = { ...repo, sourceKind: "url" as const, url: "https://example.com/a/b.git" };
		const ws = await resolveWorkspace(
			job({ thread: { ...job().thread, repos: [url] } as InvestigationJobData["thread"] }),
			ports,
		);
		expect(ws.layout).not.toBe("in_place");
	});

	it("a follow-up reopens in the same checkout; a moved one is refused, never rebuilt", async () => {
		const first = await resolveWorkspace(job(), ports);
		const again = await rebuildWorkspace(first, "inv", "Claude Code", ports, undefined, false, checkout);
		expect(again.layout).toBe("in_place");
		expect(again.cwd).toBe(first.cwd);
		expect(again.note).toContain("Continuing in your checkout");

		renameSync(checkout, `${checkout}-moved`);
		try {
			await expect(
				rebuildWorkspace(first, "inv", "Claude Code", ports, undefined, false, checkout),
			).rejects.toThrow(/gone or is now somewhere else/);
			const moved = await resolveWorkspace(job(), ports);
			expect(moved.layout).toBe("unmapped");
			expect(moved.note).toContain("is gone or is now somewhere else");
		} finally {
			renameSync(`${checkout}-moved`, checkout);
		}
		await expect(
			rebuildWorkspace(first, "inv", "Claude Code", ports, undefined, false, null),
		).rejects.toThrow(/gone or is now somewhere else/);
	});

	it("the run's log gets a workspace_borrowed entry with counts only", async () => {
		const emitted: unknown[] = [];
		const appended = vi.fn(async () => {});
		const borrowed = (await resolveWorkspace(job(), ports)).borrowed;
		const next = await logBorrowed(
			"run-1",
			{ emit: async (e: unknown) => void emitted.push(e) } as never,
			{ lastEventSeq: async () => 4, appendEvents: appended } as never,
			borrowed,
			null,
		);
		expect(next).toBe(6);
		expect(emitted).toHaveLength(1);
		const event = emitted[0] as { seq: number; result: { name: string; preview: string } };
		expect(event.seq).toBe(5);
		expect(event.result.name).toBe("workspace_borrowed");
		expect(JSON.parse(event.result.preview)).toEqual({
			path: checkout,
			head: borrowed?.head,
			branch: "main",
			dirty: { staged: 0, unstaged: 1, untracked: 0 },
		});
		expect(await logBorrowed("run-1", {} as never, {} as never, undefined, 9)).toBe(9);
	});
});
