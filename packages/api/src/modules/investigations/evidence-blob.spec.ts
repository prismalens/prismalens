// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The evidence blob read (proposal item 2): real git on mkdtemp repos, no
 * spawn mock, so each fence is what git did, not the argv we built.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunWorkspace } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mirrorPathFor } from "../../core/harness/repo-source.service.js";
import { EvidenceRequestRefused, readEvidenceBlob } from "./evidence-blob.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const ID = ["-c", "user.email=t@t.local", "-c", "user.name=T"];

function git(args: string[], cwd: string, input?: string): string {
	return execFileSync("git", [...ID, ...args], { cwd, env: GIT_ENV, input })
		.toString()
		.trim();
}

function commitAll(dir: string, msg: string): string {
	git(["add", "--", "."], dir);
	git(["commit", "-q", "-m", msg], dir);
	return git(["rev-parse", "HEAD"], dir);
}

/** A symlink entry written straight into the index: no filesystem symlink needed. */
function addSymlink(dir: string, name: string, target: string): void {
	const oid = git(["hash-object", "-w", "--stdin"], dir, target);
	git(["update-index", "--add", "--cacheinfo", `120000,${oid},${name}`], dir);
}

function workspace(
	head: string,
	repo: Partial<RunWorkspace["repos"][number]>,
): RunWorkspace {
	return {
		layout: "single",
		cwd: "/gone/run/repo",
		repos: [
			{
				name: "repo",
				dir: "/gone/run/repo",
				sourceKind: "folder",
				url: "",
				subPath: null,
				connectionId: null,
				head,
				branch: "main",
				services: ["checkout"],
				...repo,
			},
		],
	};
}

let root: string;
let src: string;
let head: string;
let ws: RunWorkspace;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-evidence-"));
	src = join(root, "src-repo");
	mkdirSync(join(src, "src", "db"), { recursive: true });
	git(["init", "-q", "-b", "main", src], root);
	writeFileSync(join(src, "src", "db", "pool.ts"), "const max = 10;\n");
	writeFileSync(join(src, "logo.png"), Buffer.from([0x89, 0x50, 0, 0, 1, 2]));
	git(["add", "-A"], src);
	addSymlink(src, "escape", "../../../../etc/passwd");
	addSymlink(src, "dirlink", "src");
	// Committed from the index as is: `add -A` would drop links the checkout never made.
	git(["commit", "-q", "-m", "init"], src);
	head = git(["rev-parse", "HEAD"], src);
	const modes = git(["ls-tree", head, "--", "escape", "dirlink"], src)
		.split("\n")
		.map((l) => l.slice(0, 6));
	expect(modes).toEqual(["120000", "120000"]);
	ws = workspace(head, { url: src });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readEvidenceBlob: a folder source", () => {
	it("serves the tracked blob at the recorded commit, not what the folder holds now", async () => {
		writeFileSync(join(src, "src", "db", "pool.ts"), "const max = 50;\n");
		commitAll(src, "later");
		writeFileSync(join(src, "src", "db", "pool.ts"), "WIP edit\n");
		const blob = await readEvidenceBlob(ws, head, "src/db/pool.ts");
		expect(blob).toEqual({
			state: "ok",
			repo: "repo",
			sha: head,
			path: "src/db/pool.ts",
			kind: "file",
			size: 16,
			content: "const max = 10;\n",
			omitted: null,
		});
	});

	it("an untracked or uncommitted file was never in the commit: not retained", async () => {
		writeFileSync(join(src, "notes.txt"), "scratch");
		const blob = await readEvidenceBlob(ws, head, "notes.txt");
		expect(blob).toMatchObject({ state: "unavailable", reason: "not-retained" });
	});

	it("a directory or a submodule is not a file", async () => {
		const blob = await readEvidenceBlob(ws, head, "src/db");
		expect(blob).toMatchObject({ state: "unavailable", reason: "not-a-file" });
	});

	it("a binary blob is named, not sent", async () => {
		const blob = await readEvidenceBlob(ws, head, "logo.png");
		expect(blob).toMatchObject({ state: "ok", content: null, omitted: "binary", size: 6 });
	});

	it("a folder that is gone, or no longer a repository, reads as source removed", async () => {
		rmSync(join(src, ".git"), { recursive: true, force: true });
		expect(await readEvidenceBlob(ws, head, "src/db/pool.ts")).toMatchObject({
			state: "unavailable",
			reason: "source-removed",
		});
		rmSync(src, { recursive: true, force: true });
		expect(await readEvidenceBlob(ws, head, "src/db/pool.ts")).toMatchObject({
			state: "unavailable",
			reason: "source-removed",
		});
	});

	it("a commit the repository no longer has reads as commit gone", async () => {
		const lost = "0123456789abcdef0123456789abcdef01234567";
		const blob = await readEvidenceBlob(workspace(lost, { url: src }), lost, "src/db/pool.ts");
		expect(blob).toMatchObject({ state: "unavailable", reason: "commit-gone" });
	});
});

describe("readEvidenceBlob: symlinks are text, never followed", () => {
	it("a symlink's content is its target, even one pointing out of the repo", async () => {
		const blob = await readEvidenceBlob(ws, head, "escape");
		expect(blob).toMatchObject({
			state: "ok",
			kind: "symlink",
			content: "../../../../etc/passwd",
		});
	});

	it("a path through a symlinked directory does not resolve", async () => {
		const blob = await readEvidenceBlob(ws, head, "dirlink/db/pool.ts");
		expect(blob).toMatchObject({ state: "unavailable", reason: "not-retained" });
	});
});

describe("readEvidenceBlob: refused before git runs", () => {
	it("path traversal, absolute and backslash paths are refused", async () => {
		for (const path of ["../src-repo/src/db/pool.ts", "src/../../x", "/etc/passwd", "C:/Windows/win.ini", "src\\db\\pool.ts", ""])
			await expect(readEvidenceBlob(ws, head, path), path).rejects.toBeInstanceOf(
				EvidenceRequestRefused,
			);
	});

	it("a sha that is an option, a ref, an expression or an abbreviation is refused", async () => {
		for (const sha of ["--output=/tmp/x", "HEAD", "main", `${head}^{tree}`, head.slice(0, 7), `${head} --all`, head.toUpperCase()])
			await expect(readEvidenceBlob(ws, sha, "src/db/pool.ts"), sha).rejects.toBeInstanceOf(
				EvidenceRequestRefused,
			);
	});

	it("a real commit this run did not record is refused, so no other history is readable", async () => {
		writeFileSync(join(src, "secret.txt"), "later");
		const other = commitAll(src, "after the run");
		await expect(readEvidenceBlob(ws, other, "secret.txt")).rejects.toBeInstanceOf(
			EvidenceRequestRefused,
		);
	});

	it("a run that recorded no workspace serves nothing", async () => {
		await expect(readEvidenceBlob(null, head, "src/db/pool.ts")).rejects.toBeInstanceOf(
			EvidenceRequestRefused,
		);
	});
});

describe("readEvidenceBlob: a URL source reads its bare mirror", () => {
	const url = "https://git.example.test/acme/checkout.git";

	it("reads from the mirror the run cloned from", async () => {
		const mirrors = join(root, "repos");
		const mirror = mirrorPathFor(url, mirrors);
		mkdirSync(join(mirror, ".."), { recursive: true });
		git(["clone", "-q", "--mirror", "--", src, mirror], root);
		const blob = await readEvidenceBlob(
			workspace(head, { sourceKind: "url", url }),
			head,
			"src/db/pool.ts",
			{ mirrorRoot: mirrors },
		);
		expect(blob).toMatchObject({ state: "ok", content: "const max = 10;\n" });
	});

	it("a pruned mirror reads as source removed", async () => {
		const blob = await readEvidenceBlob(
			workspace(head, { sourceKind: "url", url }),
			head,
			"src/db/pool.ts",
			{ mirrorRoot: join(root, "no-mirrors") },
		);
		expect(blob).toMatchObject({ state: "unavailable", reason: "source-removed" });
	});
});
