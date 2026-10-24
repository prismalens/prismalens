// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildPreRunSnapshot,
	parseStoredSnapshot,
	snapshotWindow,
	summaryOf,
	writeReadCopies,
} from "./pre-run-context.js";

const NOW = new Date("2026-10-24T10:00:00Z");
const WINDOW = { start: new Date("2026-10-24T09:00:00Z"), end: NOW };

describe("the run's pre-run snapshot (#848)", () => {
	it("holds the snapshot, past incidents and runbooks as scrubbed files, and reads back as stored", () => {
		const ctx = buildPreRunSnapshot({
			window: WINDOW,
			telemetry: [
				{
					kind: "prometheus",
					label: "prod prom",
					from: "set",
					status: "found",
					part: { summary: "2 rule alerts", data: { alerts: [{ token: "tok-123456" }] }, count: 1 },
					secrets: ["tok-123456"],
				},
				{ kind: "loki", label: "LOKI_URL", from: "env", status: "skipped", reason: "the source did not answer in time" },
			],
			pastIncidents: [{ reference: "INC-7", title: "pool exhausted" } as never],
			runbooks: [
				{
					title: "checkout",
					path: "repo/runbooks/checkout.md",
					service: "checkout",
					matchedBy: "runbooks/",
					origin: "repo",
				},
			],
			now: NOW,
		});
		expect(ctx.files.map((f) => f.name)).toEqual([
			"telemetry-prometheus-1.json",
			"past-incidents.json",
			"runbooks.md",
		]);
		const text = (name: string) => ctx.files.find((f) => f.name === name)?.text ?? "";
		const snap = text("telemetry-prometheus-1.json");
		expect(snap).toContain("[redacted]");
		expect(snap).not.toContain("tok-123456");
		expect(JSON.parse(snap).window).toEqual({ start: "2026-10-24T09:00:00.000Z", end: "2026-10-24T10:00:00.000Z" });
		expect(text("runbooks.md")).toContain("Path: repo/runbooks/checkout.md");
		expect(ctx.sources).toEqual([
			expect.objectContaining({ label: "prod prom", status: "found", file: "telemetry-prometheus-1.json" }),
			{ kind: "loki", label: "LOKI_URL", from: "env", status: "skipped", detail: "the source did not answer in time" },
		]);
		expect(parseStoredSnapshot(JSON.stringify(ctx))).toEqual(ctx);
	});

	it("with every source skipped it still names them, and holds no telemetry file", () => {
		const ctx = buildPreRunSnapshot({
			window: WINDOW,
			telemetry: [{ kind: "prometheus", label: "p", from: "set", status: "skipped", reason: "credential missing" }],
			pastIncidents: [],
			runbooks: [],
			now: NOW,
		});
		expect(ctx.files).toEqual([]);
		expect(ctx.sources[0]).toMatchObject({ status: "skipped", detail: "credential missing" });
	});

	it("a stored text that does not parse reads as none", () => {
		expect(parseStoredSnapshot("{not json")).toBeNull();
		expect(parseStoredSnapshot(JSON.stringify({ fetchedAt: "x" }))).toBeNull();
	});

	it("the window starts half an hour before the first alert, at most six hours back", () => {
		const alert = (startsAt: string | null) => ({ alertname: "a", severity: null, labels: {}, annotations: {}, startsAt });
		expect(snapshotWindow([alert("2026-10-24T09:20:00Z"), alert(null)], NOW, "checkout")).toEqual({
			start: new Date("2026-10-24T08:50:00Z"),
			end: NOW,
			service: "checkout",
		});
		expect(snapshotWindow([alert("2026-10-20T00:00:00Z")], NOW).start).toEqual(new Date("2026-10-24T04:00:00Z"));
		expect(snapshotWindow([alert(null)], NOW).start).toEqual(new Date("2026-10-24T09:00:00Z"));
	});

	it("200 log lines of 1,000 three-byte characters stay under 262,144 bytes, with truncated recorded", async () => {
		const runDir = mkdtempSync(join(os.tmpdir(), "pl-prerun-"));
		try {
			const euro = "\u20AC";
			const line = euro.repeat(1000);
			const ctx = buildPreRunSnapshot({
				window: WINDOW,
				telemetry: [
					{
						kind: "loki",
						label: "loki-prod",
						from: "set",
						status: "found",
						part: {
							summary: "200 lines",
							data: {
								result: [
									{
										stream: { service: "checkout" },
										values: Array.from({ length: 200 }, (_, i) => [String(i), line]),
									},
								],
							},
							count: 200,
						},
						secrets: [],
					},
				],
				pastIncidents: [],
				runbooks: [],
				now: NOW,
			});
			await writeReadCopies([{ dir: runDir }], "run-1", ctx);
			const file = join(runDir, ".prismalens/runs/run-1", "telemetry-loki-1.json");
			const content = readFileSync(file);
			expect(content.byteLength).toBeLessThanOrEqual(262_144);
			expect(ctx.sources[0]?.truncated).toEqual({
				dropped: expect.any(Number),
				reason: "the 256 KiB snapshot limit",
			});
			expect(ctx.sources[0]?.truncated?.dropped).toBeGreaterThan(0);
		} finally {
			rmSync(runDir, { recursive: true, force: true });
		}
	});
});

describe("safe writing of read copies and scrubbing (#848)", () => {
	function fingerprint(dir: string): Record<string, string> {
		const result: Record<string, string> = {};
		if (!existsSync(dir)) return result;
		function walk(current: string) {
			for (const name of readdirSync(current)) {
				const full = join(current, name);
				const rel = relative(dir, full).replace(/\\/g, "/");
				try {
					const st = lstatSync(full);
					if (st.isSymbolicLink()) {
						result[rel] = "symlink";
					} else if (st.isDirectory()) {
						result[rel] = "dir";
						walk(full);
					} else if (st.isFile()) {
						result[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
					}
				} catch {
					result[rel] = "error";
				}
			}
		}
		walk(dir);
		return result;
	}

	function initGitRepo(dir: string) {
		execSync("git init", { cwd: dir, stdio: "ignore" });
		execSync("git config user.email test@example.com", { cwd: dir, stdio: "ignore" });
		execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
	}

	const sampleSnapshot = buildPreRunSnapshot({
		window: WINDOW,
		telemetry: [
			{
				kind: "loki",
				label: "logs",
				from: "set",
				status: "found",
				part: { summary: "3 logs", data: { entries: [] }, count: 3 },
				secrets: [],
			},
		],
		pastIncidents: [],
		runbooks: [],
		now: NOW,
	});

	it("refuses a nested runs symlink (POSIX) or junction (Windows) and leaves dirs untouched", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-copy-refuse-"));
		const cwd = join(tmp, "cwd");
		const outside = join(tmp, "outside");
		mkdirSync(cwd);
		mkdirSync(outside);
		mkdirSync(join(outside, "target"));
		mkdirSync(join(cwd, ".prismalens"));
		if (process.platform === "win32") {
			symlinkSync(join(outside, "target"), join(cwd, ".prismalens", "runs"), "junction");
		} else {
			symlinkSync(join(outside, "target"), join(cwd, ".prismalens", "runs"), "dir");
		}

		const beforeCwd = fingerprint(cwd);
		const beforeOutside = fingerprint(outside);

		const res = await writeReadCopies([{ dir: cwd }], "run-symlink", sampleSnapshot);
		expect(res.state).toBe("failed");
		expect(fingerprint(cwd)).toEqual(beforeCwd);
		expect(fingerprint(outside)).toEqual(beforeOutside);
		rmSync(tmp, { recursive: true, force: true });
	});

	it("refuses an untracked or symlinked .gitignore and leaves dirs untouched", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-copy-git-"));
		const cwd = join(tmp, "cwd");
		const outside = join(tmp, "outside");
		mkdirSync(cwd);
		mkdirSync(outside);
		mkdirSync(join(cwd, ".prismalens", "runs"), { recursive: true });
		writeFileSync(join(cwd, ".prismalens", "runs", ".gitignore"), "existing");

		const beforeCwd = fingerprint(cwd);
		const beforeOutside = fingerprint(outside);

		const res = await writeReadCopies([{ dir: cwd }], "run-git", sampleSnapshot);
		expect(res.state).toBe("failed");
		expect(res.reason).toContain("an existing .prismalens/runs/.gitignore belongs to the repository");
		expect(fingerprint(cwd)).toEqual(beforeCwd);
		expect(fingerprint(outside)).toEqual(beforeOutside);

		if (process.platform !== "win32") {
			rmSync(join(cwd, ".prismalens", "runs", ".gitignore"));
			writeFileSync(join(outside, "ignored"), "*\n");
			symlinkSync(join(outside, "ignored"), join(cwd, ".prismalens", "runs", ".gitignore"));
			const bCwd = fingerprint(cwd);
			const bOut = fingerprint(outside);
			const res2 = await writeReadCopies([{ dir: cwd }], "run-git2", sampleSnapshot);
			expect(res2.state).toBe("failed");
			expect(fingerprint(cwd)).toEqual(bCwd);
			expect(fingerprint(outside)).toEqual(bOut);
		}

		rmSync(tmp, { recursive: true, force: true });
	});

	it("refuses a tracked .prismalens file, tracked symlink, or tracked empty .gitignore", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-copy-tracked-"));
		const repoDir = join(tmp, "repo");
		const outside = join(tmp, "outside");
		mkdirSync(repoDir);
		mkdirSync(outside);
		initGitRepo(repoDir);

		writeFileSync(join(repoDir, ".prismalens"), "tracked file");
		execSync("git add .prismalens && git commit -m track-file", { cwd: repoDir, stdio: "ignore" });

		let beforeStatus = execSync("git status --porcelain", { cwd: repoDir }).toString();
		let beforeLs = execSync("git ls-files -s", { cwd: repoDir }).toString();
		let beforeRepo = fingerprint(repoDir);
		let beforeOutside = fingerprint(outside);

		let res = await writeReadCopies([{ dir: repoDir, checkout: repoDir }], "run-1", sampleSnapshot);
		expect(res.state).toBe("failed");
		expect(res.reason).toContain(".prismalens is not a folder");
		expect(execSync("git status --porcelain", { cwd: repoDir }).toString()).toBe(beforeStatus);
		expect(execSync("git ls-files -s", { cwd: repoDir }).toString()).toBe(beforeLs);
		expect(fingerprint(repoDir)).toEqual(beforeRepo);
		expect(fingerprint(outside)).toEqual(beforeOutside);
		execSync("git rm -f .prismalens", { cwd: repoDir, stdio: "ignore" });

		// Tracked file inside .prismalens folder
		mkdirSync(join(repoDir, ".prismalens"));
		writeFileSync(join(repoDir, ".prismalens", "tracked.txt"), "tracked");
		execSync("git add .prismalens/tracked.txt && git commit -m track-in-dir", { cwd: repoDir, stdio: "ignore" });

		beforeStatus = execSync("git status --porcelain", { cwd: repoDir }).toString();
		beforeLs = execSync("git ls-files -s", { cwd: repoDir }).toString();
		beforeRepo = fingerprint(repoDir);
		beforeOutside = fingerprint(outside);

		res = await writeReadCopies([{ dir: repoDir, checkout: repoDir }], "run-1b", sampleSnapshot);
		expect(res.state).toBe("failed");
		expect(res.reason).toContain("the repository tracks .prismalens");
		expect(execSync("git status --porcelain", { cwd: repoDir }).toString()).toBe(beforeStatus);
		expect(execSync("git ls-files -s", { cwd: repoDir }).toString()).toBe(beforeLs);
		expect(fingerprint(repoDir)).toEqual(beforeRepo);
		expect(fingerprint(outside)).toEqual(beforeOutside);
		execSync("git rm -rf .prismalens", { cwd: repoDir, stdio: "ignore" });

		if (process.platform !== "win32") {
			symlinkSync(outside, join(repoDir, ".prismalens"));
			execSync("git add .prismalens && git commit -m track-symlink", { cwd: repoDir, stdio: "ignore" });

			beforeStatus = execSync("git status --porcelain", { cwd: repoDir }).toString();
			beforeLs = execSync("git ls-files -s", { cwd: repoDir }).toString();
			beforeRepo = fingerprint(repoDir);
			beforeOutside = fingerprint(outside);

			res = await writeReadCopies([{ dir: repoDir, checkout: repoDir }], "run-2", sampleSnapshot);
			expect(res.state).toBe("failed");
			expect(execSync("git status --porcelain", { cwd: repoDir }).toString()).toBe(beforeStatus);
			expect(execSync("git ls-files -s", { cwd: repoDir }).toString()).toBe(beforeLs);
			expect(fingerprint(repoDir)).toEqual(beforeRepo);
			expect(fingerprint(outside)).toEqual(beforeOutside);
			execSync("git rm -f .prismalens", { cwd: repoDir, stdio: "ignore" });
		}

		mkdirSync(join(repoDir, ".prismalens", "runs"), { recursive: true });
		writeFileSync(join(repoDir, ".prismalens", "runs", ".gitignore"), "");
		execSync("git add .prismalens/runs/.gitignore && git commit -m track-gitignore", { cwd: repoDir, stdio: "ignore" });

		beforeStatus = execSync("git status --porcelain", { cwd: repoDir }).toString();
		beforeLs = execSync("git ls-files -s", { cwd: repoDir }).toString();
		beforeRepo = fingerprint(repoDir);
		beforeOutside = fingerprint(outside);

		res = await writeReadCopies([{ dir: repoDir, checkout: repoDir }], "run-3", sampleSnapshot);
		expect(res.state).toBe("failed");
		expect(execSync("git status --porcelain", { cwd: repoDir }).toString()).toBe(beforeStatus);
		expect(execSync("git ls-files -s", { cwd: repoDir }).toString()).toBe(beforeLs);
		expect(fingerprint(repoDir)).toEqual(beforeRepo);
		expect(fingerprint(outside)).toEqual(beforeOutside);

		rmSync(tmp, { recursive: true, force: true });
	});

	it("an absent .prismalens is written, with a clean git status", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-copy-absent-"));
		const repoDir = join(tmp, "repo");
		mkdirSync(repoDir);
		initGitRepo(repoDir);
		writeFileSync(join(repoDir, "file.txt"), "hello");
		execSync("git add file.txt && git commit -m init", { cwd: repoDir, stdio: "ignore" });

		const res = await writeReadCopies([{ dir: repoDir, checkout: repoDir }], "run-clean", sampleSnapshot);
		expect(res.state).toBe("written");
		expect(existsSync(join(repoDir, ".prismalens", "runs", "run-clean", "index.json"))).toBe(true);
		expect(execSync("git status --porcelain", { cwd: repoDir }).toString().trim()).toBe("");

		rmSync(tmp, { recursive: true, force: true });
	});

	it("multi layout: writes two copies", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-copy-multi-"));
		const t1 = join(tmp, "t1");
		const t2 = join(tmp, "t2");
		mkdirSync(t1);
		mkdirSync(t2);

		const res = await writeReadCopies([{ dir: t1 }, { dir: t2 }], "run-multi", sampleSnapshot);
		expect(res.state).toBe("written");
		expect(existsSync(join(t1, ".prismalens", "runs", "run-multi", "index.json"))).toBe(true);
		expect(existsSync(join(t2, ".prismalens", "runs", "run-multi", "index.json"))).toBe(true);

		rmSync(tmp, { recursive: true, force: true });
	});

	it("a traversal runId throws before any write", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-copy-trav-"));
		const before = fingerprint(tmp);

		await expect(writeReadCopies([{ dir: tmp }], "../escape", sampleSnapshot)).rejects.toThrow(
			/Invalid run id/,
		);
		expect(fingerprint(tmp)).toEqual(before);

		rmSync(tmp, { recursive: true, force: true });
	});

	it("scrubbing: a quoted bearer, a multi-line key, and a 3-character token (skipped)", () => {
		const quotedBearer = '"Bearer secret-token-xyz"';
		const multiLineKey = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk\n-----END PRIVATE KEY-----";
		const shortToken = "abc";

		const snap = buildPreRunSnapshot({
			window: WINDOW,
			telemetry: [
				{
					kind: "prometheus",
					label: "prom",
					from: "set",
					status: "found",
					part: {
						summary: `alerts with ${quotedBearer}`,
						data: {
							auth: quotedBearer,
							key: multiLineKey,
							short: shortToken,
						},
						count: 1,
					},
					secrets: [quotedBearer, multiLineKey, shortToken],
				},
			],
			pastIncidents: [],
			runbooks: [],
			now: NOW,
		});

		const storedText = JSON.stringify(snap);
		expect(storedText).not.toContain(quotedBearer);
		expect(storedText).not.toContain(multiLineKey);
		expect(storedText).toContain(shortToken);

		const parsedStored = JSON.parse(storedText);
		const jsonDump = JSON.stringify(parsedStored);
		expect(jsonDump).not.toContain(quotedBearer);
		expect(jsonDump).not.toContain(multiLineKey);

		const excerpt = snap.sources[0]?.excerpt ?? "";
		expect(excerpt).not.toContain(quotedBearer);
		expect(excerpt).not.toContain(multiLineKey);

		const indexDump = JSON.stringify(summaryOf(snap));
		expect(indexDump).not.toContain(quotedBearer);
		expect(indexDump).not.toContain(multiLineKey);
	});
});
