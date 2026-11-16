// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The diff fixture (#1101 category 16): a project thread in its own worktree, two agent turns,
 * a user edit between them and an untracked file, read back by scope and reverted. Also the
 * one-line fixture: `pnpm --filter @prismalens/api exec vitest run test/scenarios/diff-turns.spec.ts`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RevertChangesResult, WorktreeChanges } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
const source = join(pl.workspace, "shop");
const APP_V1 =
	"line 1\nline 2\ntimeout = 5\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nretries = 1\n";
let threadId = "";
let worktree = "";

const live = (s: string) => ["pending", "running", "queued"].includes(s);
const idle = (id: string, what: string) =>
	eventually(
		() => pl.api<{ status: string }>(`/investigations/${id}`),
		(i) => !live(i.status),
		what,
		30_000,
	);
const scope = (s: string, turn?: number) =>
	pl.api<WorktreeChanges>(
		`/investigations/${threadId}/changes?scope=${s}${turn === undefined ? "" : `&turn=${turn}`}`,
	);
const files = (c: WorktreeChanges) => {
	const r = c.repos[0];
	return r?.state === "ok" ? r.files.map((f) => `${f.status} ${f.path}`).sort() : [];
};

beforeAll(async () => {
	await pl.boot();
	mkdirSync(join(source, "src"), { recursive: true });
	writeFileSync(join(source, "README.md"), "# shop\n");
	writeFileSync(join(source, "src", "app.txt"), APP_V1);
	const git = (...a: string[]) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], {
			cwd: source,
		});
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	const project = await pl.api<{ id: string }>("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const started = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: {
			subject: { kind: "project", repositoryId: project.id },
			text: "fake-session:diff-turns fix the timeout",
		},
	});
	threadId = started.investigationId;
	await idle(threadId, "the first turn to end");
	const run = await pl.api<{ workspace: { cwd: string } }>(`/investigations/${threadId}`);
	worktree = run.workspace.cwd;
	// The user's own edit between the turns.
	writeFileSync(join(worktree, "README.md"), "# shop\n\nEdited by hand.\n");
	await pl.api(`/investigations/${threadId}/messages`, {
		method: "POST",
		body: { text: "Retries look low" },
	});
	await eventually(
		() => pl.api<{ status: string }>(`/investigations/${threadId}`),
		(i) => !live(i.status) && readFileSync(join(worktree, "NOTES.md"), "utf8").length > 0,
		"the second turn to end",
		30_000,
	);
}, 120_000);

afterAll(() => pl.dispose());

describe("The thread's diff by scope (#1101 category 16)", () => {
	it("all vs base lists the agent's file, the user's edit and the untracked notes", async () => {
		expect(files(await scope("all"))).toEqual([
			"added NOTES.md",
			"modified README.md",
			"modified src/app.txt",
		]);
	});

	it("each turn lists only what that turn changed, and the user's edit is marked outside the turns", async () => {
		const all = await scope("all");
		const r = all.repos[0];
		if (r?.state !== "ok" || !r.scoped) throw new Error("no scoped diff");
		expect(r.scoped.turns.length).toBe(2);
		expect(r.scoped.outside).toEqual(["README.md"]);
		const [first, second] = r.scoped.turns;
		expect(files(await scope("turn", first?.seq))).toEqual(["modified src/app.txt"]);
		expect(files(await scope("turn", second?.seq))).toEqual([
			"added NOTES.md",
			"modified src/app.txt",
		]);
		expect(files(await scope("outside"))).toEqual(["modified README.md"]);
	});

	it("undoing the second turn restores its start and keeps the user's edit", async () => {
		const all = await scope("all");
		const r = all.repos[0];
		if (r?.state !== "ok" || !r.scoped) throw new Error("no scoped diff");
		const second = r.scoped.turns[1]?.seq as number;
		const done = await pl.api<RevertChangesResult>(
			`/investigations/${threadId}/changes/revert`,
			{
				method: "POST",
				body: {
					repo: r.repo,
					scope: "turn",
					turn: second,
					from: r.scoped.from,
					target: { kind: "turn", seq: second },
					expect: {},
				},
			},
		);
		expect(done.state).toBe("done");
		expect(readFileSync(join(worktree, "src", "app.txt"), "utf8")).toContain("retries = 3\n");
		expect(readFileSync(join(worktree, "README.md"), "utf8")).toBe("# shop\n\nEdited by hand.\n");
		expect(() => readFileSync(join(worktree, "NOTES.md"))).toThrow();
	});
});
