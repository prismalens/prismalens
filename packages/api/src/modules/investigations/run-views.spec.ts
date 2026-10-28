// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The panel's tree and diff reads (#973): real git on mkdtemp repos, as in
 * evidence-blob.spec, so each fence is what git did.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunComparison, RunWorkspace } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvidenceRequestRefused } from "./evidence-blob.js";
import { compareFor, readRunDiff, readRunTree } from "./run-views.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const ID = ["-c", "user.email=t@t.local", "-c", "user.name=T"];

function git(args: string[], cwd: string, input?: string): string {
	return execFileSync("git", [...ID, ...args], { cwd, env: GIT_ENV, input })
		.toString()
		.trim();
}

function commit(dir: string, files: Record<string, string>, msg: string) {
	for (const [p, body] of Object.entries(files)) {
		mkdirSync(join(dir, p, ".."), { recursive: true });
		writeFileSync(join(dir, p), body);
	}
	// Only these files: `add -A` would drop a link written straight into the index.
	git(["add", "--", ...Object.keys(files)], dir);
	git(["commit", "-q", "-m", msg], dir);
	return git(["rev-parse", "HEAD"], dir);
}

function addSymlink(dir: string, name: string, target: string): void {
	const oid = git(["hash-object", "-w", "--stdin"], dir, target);
	git(["update-index", "--add", "--cacheinfo", `120000,${oid},${name}`], dir);
}

let root: string;
let src: string;
let c1: string;
let c2: string;
let c3: string;

function ws(head: string, compare?: RunComparison[]): RunWorkspace {
	return {
		layout: "single",
		cwd: "/gone/run/repo",
		repos: [
			{
				name: "repo",
				dir: "/gone/run/repo",
				sourceKind: "folder",
				url: src,
				subPath: null,
				connectionId: null,
				head,
				branch: "main",
				services: ["checkout"],
			},
		],
		...(compare ? { compare } : {}),
	};
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-runviews-"));
	src = join(root, "src-repo");
	git(["init", "-q", "-b", "main", src], root);
	c1 = commit(
		src,
		{ "src/payments/client.ts": "timeoutMs: 3000\n", "README.md": "hi\n" },
		"one",
	);
	git(["tag", "v2.13.2"], src);
	c2 = commit(src, { "CHANGELOG.md": "notes\n" }, "two");
	addSymlink(src, "escape", "../../../../etc/passwd");
	git(["commit", "-q", "-m", "link"], src);
	c3 = commit(src, { "src/payments/client.ts": "timeoutMs: 800\n" }, "three");
	git(["tag", "v2.14.0"], src);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readRunTree", () => {
	it("lists one directory of the recorded commit, with each entry's kind", async () => {
		const tree = await readRunTree(ws(c3), c3, undefined);
		expect(tree).toMatchObject({ state: "ok", prefix: null, truncated: false });
		if (tree.state !== "ok") return;
		expect(tree.entries).toEqual([
			{ name: "src", path: "src", type: "dir" },
			{ name: "CHANGELOG.md", path: "CHANGELOG.md", type: "file" },
			{ name: "README.md", path: "README.md", type: "file" },
			{ name: "escape", path: "escape", type: "symlink" },
		]);
		const sub = await readRunTree(ws(c3), c3, "src/payments");
		expect(sub.state === "ok" && sub.entries).toEqual([
			{ name: "client.ts", path: "src/payments/client.ts", type: "file" },
		]);
	});

	it("refuses a commit the run did not record", async () => {
		await expect(readRunTree(ws(c3), c1, undefined)).rejects.toBeInstanceOf(
			EvidenceRequestRefused,
		);
		await expect(readRunTree(ws(c3), "HEAD", undefined)).rejects.toBeInstanceOf(
			EvidenceRequestRefused,
		);
	});

	it.each([
		"..",
		"src/../..",
		"/etc",
		"C:/Windows",
		"src\\payments",
		"src\u0000x",
		"",
	])("refuses the prefix %j", async (prefix) => {
		await expect(readRunTree(ws(c3), c3, prefix)).rejects.toBeInstanceOf(
			EvidenceRequestRefused,
		);
	});

	it("takes pathspec magic and option-looking names literally", async () => {
		for (const prefix of [":(glob)*", "--all", "-r"]) {
			const tree = await readRunTree(ws(c3), c3, prefix);
			expect(tree).toMatchObject({ state: "unavailable", reason: "not-a-dir" });
		}
	});

	it("never follows a symlink: listing through it is not a directory", async () => {
		const tree = await readRunTree(ws(c3), c3, "escape");
		expect(tree).toMatchObject({ state: "unavailable", reason: "not-a-dir" });
	});

	it("says when the source is gone", async () => {
		rmSync(src, { recursive: true, force: true });
		const tree = await readRunTree(ws(c3), c3, undefined);
		expect(tree).toMatchObject({ state: "unavailable", reason: "source-removed" });
	});
});

describe("compareFor", () => {
	it("pairs the newest recorded deployment with the one before it", async () => {
		const pair = await compareFor(src, "repo", c3, [
			{ sha: c3, name: "v2.14.0" },
			{ sha: c1, name: "v2.13.2" },
		]);
		expect(pair).toEqual({
			repo: "repo",
			head: c3,
			headKind: "deployment",
			headName: "v2.14.0",
			base: c1,
			baseKind: "deployment",
			baseName: "v2.13.2",
			between: 3,
		});
	});

	it("skips a deployment that is not in the recorded head's history", async () => {
		git(["checkout", "-q", "-b", "side", c1], src);
		const side = commit(src, { "x.txt": "x\n" }, "side");
		git(["checkout", "-q", "main"], src);
		const pair = await compareFor(src, "repo", c3, [
			{ sha: side, name: "side" },
			{ sha: c3, name: "v2.14.0" },
			{ sha: c1, name: "v2.13.2" },
		]);
		expect(pair?.head).toBe(c3);
		expect(pair?.base).toBe(c1);
	});

	it("falls back to tags, named as tags and never as deployments", async () => {
		const pair = await compareFor(src, "repo", c3, []);
		expect(pair).toMatchObject({
			head: c3,
			headKind: "tag",
			headName: "v2.14.0",
			base: c1,
			baseKind: "tag",
			baseName: "v2.13.2",
			between: 3,
		});
	});

	it("falls back to the parent when nothing names the ends", async () => {
		git(["tag", "-d", "v2.14.0"], src);
		git(["tag", "-d", "v2.13.2"], src);
		const pair = await compareFor(src, "repo", c3, []);
		expect(pair).toMatchObject({
			head: c3,
			headKind: "commit",
			base: git(["rev-parse", `${c3}^`], src),
			baseKind: "commit",
			between: 1,
		});
	});

	it("records nothing for a root commit", async () => {
		const solo = join(root, "solo");
		git(["init", "-q", "-b", "main", solo], root);
		const only = commit(solo, { "a.txt": "a\n" }, "only");
		expect(await compareFor(solo, "repo", only, [])).toBeNull();
	});
});

describe("readRunDiff", () => {
	const pairOf = (): RunComparison => ({
		repo: "repo",
		head: c3,
		headKind: "tag",
		headName: "v2.14.0",
		base: c1,
		baseKind: "tag",
		baseName: "v2.13.2",
		between: 3,
	});

	it("serves the recorded pair's patch and per-file counts", async () => {
		const diff = await readRunDiff(ws(c3, [pairOf()]), 0, undefined);
		expect(diff.state).toBe("ok");
		if (diff.state !== "ok") return;
		expect(diff.files).toEqual([
			{ path: "CHANGELOG.md", oldPath: null, additions: 1, deletions: 0 },
			{ path: "escape", oldPath: null, additions: 1, deletions: 0 },
			{
				path: "src/payments/client.ts",
				oldPath: null,
				additions: 1,
				deletions: 1,
			},
		]);
		expect(diff.patch).toContain("-timeoutMs: 3000");
		expect(diff.patch).toContain("+timeoutMs: 800");
	});

	it("narrows to one path", async () => {
		const diff = await readRunDiff(
			ws(c3, [pairOf()]),
			0,
			"src/payments/client.ts",
		);
		expect(diff.state === "ok" && diff.files.map((f) => f.path)).toEqual([
			"src/payments/client.ts",
		]);
	});

	it("refuses an index the run did not record, and a run that recorded none", async () => {
		await expect(
			readRunDiff(ws(c3, [pairOf()]), 1, undefined),
		).rejects.toBeInstanceOf(EvidenceRequestRefused);
		await expect(readRunDiff(ws(c3), 0, undefined)).rejects.toBeInstanceOf(
			EvidenceRequestRefused,
		);
	});

	it.each(["..", "/etc/passwd", "C:/x", "a\\b"])(
		"refuses the path %j",
		async (path) => {
			await expect(
				readRunDiff(ws(c3, [pairOf()]), 0, path),
			).rejects.toBeInstanceOf(EvidenceRequestRefused);
		},
	);

	it("ignores the repo's own diff drivers, textconv and submodule settings", async () => {
		const sub = join(root, "sub");
		git(["init", "-q", "-b", "main", sub], root);
		commit(sub, { "secret.txt": "SUBMODULE-BYTES-1\n" }, "s1");
		git(
			["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/sub"],
			src,
		);
		git(["commit", "-q", "-m", "add sub"], src);
		const s1 = git(["rev-parse", "HEAD"], src);
		commit(join(src, "vendor/sub"), { "secret.txt": "SUBMODULE-BYTES-2\n" }, "s2");
		git(["add", "vendor/sub"], src);
		writeFileSync(join(src, ".gitattributes"), "*.ts diff=leak\n");
		git(["add", ".gitattributes"], src);
		git(["commit", "-q", "-m", "bump sub"], src);
		const s2 = git(["rev-parse", "HEAD"], src);
		git(["config", "diff.submodule", "diff"], src);
		git(["config", "diff.leak.textconv", "echo TEXTCONV-RAN"], src);
		git(["config", "diff.external", "echo EXTERNAL-RAN"], src);
		const pair: RunComparison = {
			...pairOf(),
			head: s2,
			base: s1,
			headKind: "commit",
			baseKind: "commit",
			headName: null,
			baseName: null,
			between: 1,
		};
		const diff = await readRunDiff(ws(s2, [pair]), 0, undefined);
		expect(diff.state).toBe("ok");
		if (diff.state !== "ok") return;
		expect(diff.patch).toContain("Subproject commit");
		expect(diff.patch).not.toContain("SUBMODULE-BYTES");
		expect(diff.patch).not.toContain("TEXTCONV-RAN");
		expect(diff.patch).not.toContain("EXTERNAL-RAN");
	});

	it("says when a commit of the pair is gone", async () => {
		const gone = "f".repeat(40);
		const diff = await readRunDiff(
			ws(c3, [{ ...pairOf(), base: gone }]),
			0,
			undefined,
		);
		expect(diff).toMatchObject({ state: "unavailable", reason: "commit-gone" });
	});
});
