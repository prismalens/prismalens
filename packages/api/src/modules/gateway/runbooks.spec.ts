// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	catalogRunbookLinks,
	listRunbooks,
	RUNBOOK_CHARS,
	type RunbookRepo,
	readRunbook,
} from "./runbooks.js";

const CATALOG = `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: checkout
  annotations:
    pagerduty.com/service-id: P123
    example.com/runbook: https://example.com/not-a-link-entry
  links:
    - url: https://wiki.example.com/checkout-runbook
      title: Checkout runbook
    - url: https://dash.example.com
      title: Dashboard
      type: dashboard
    - url: javascript:alert(1)
      title: Runbook
`;

let dir: string;
let repo: RunbookRepo;

function git(...args: string[]): string {
	return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}
function put(file: string, text: string) {
	const full = join(dir, file);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, text);
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "runbooks-"));
	execFileSync("git", ["init", "-q", dir]);
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
	put("runbooks/db-failover.md", "# DB failover\nPromote the replica.");
	put("docs/runbooks/cache_flush.md", "flush it");
	put("RUNBOOK.md", "root runbook");
	put("RUNBOOK-oncall.md", "oncall");
	put("runbooks/big.md", "x".repeat(RUNBOOK_CHARS + 500));
	put("runbooks/notes.txt", "not markdown");
	put("docs/guide.md", "not a runbook");
	put("catalog-info.yaml", CATALOG);
	put("secret.md", "outside the lists");
	git("add", "-A");
	git("commit", "-qm", "init");
	const head = git("rev-parse", "HEAD");
	put("runbooks/uncommitted.md", "after the recorded commit");
	repo = { name: "api", dir, head, subPath: null, services: ["checkout", "cart"] };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("listRunbooks", () => {
	it("finds markdown by the three conventions and catalog links, at the recorded commit", async () => {
		const found = await listRunbooks([repo], { service: "checkout" });
		expect(found.map((e) => [e.path, e.matchedBy]).sort()).toEqual(
			[
				["api/RUNBOOK-oncall.md", "RUNBOOK*.md"],
				["api/RUNBOOK.md", "RUNBOOK*.md"],
				["api/docs/runbooks/cache_flush.md", "docs/runbooks/"],
				["api/runbooks/big.md", "runbooks/"],
				["api/runbooks/db-failover.md", "runbooks/"],
				["https://wiki.example.com/checkout-runbook", "catalog-info.yaml"],
			].sort(),
		);
		expect(found.every((e) => e.service === "checkout")).toBe(true);
	});

	it("lists once per service when none is named, and skips a service the repo is not bound to", async () => {
		const all = await listRunbooks([repo]);
		expect(new Set(all.map((e) => e.service))).toEqual(
			new Set(["checkout", "cart"]),
		);
		expect(await listRunbooks([repo], { service: "billing" })).toEqual([]);
	});

	it("reads links from catalog-info metadata.links only, and only http(s)", () => {
		expect(catalogRunbookLinks(CATALOG)).toEqual([
			{ title: "Checkout runbook", url: "https://wiki.example.com/checkout-runbook" },
		]);
	});

	it("500 runbook files list 50 entries with 0 git show calls (#848)", async () => {
		const manyDir = mkdtempSync(join(tmpdir(), "runbooks-500-"));
		try {
			execFileSync("git", ["init", "-q", manyDir]);
			execFileSync("git", ["-C", manyDir, "config", "user.email", "t@example.com"]);
			execFileSync("git", ["-C", manyDir, "config", "user.name", "t"]);
			mkdirSync(join(manyDir, "runbooks"), { recursive: true });
			for (let i = 0; i < 500; i++) {
				writeFileSync(join(manyDir, "runbooks", `rb-${String(i).padStart(3, "0")}.md`), `# Runbook ${i}`);
			}
			writeFileSync(join(manyDir, "catalog-info.yaml"), CATALOG);
			execFileSync("git", ["-C", manyDir, "add", "-A"]);
			execFileSync("git", ["-C", manyDir, "commit", "-qm", "500 runbooks"]);
			const head = execFileSync("git", ["-C", manyDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

			const manyRepo: RunbookRepo = {
				name: "service-repo",
				dir: manyDir,
				head,
				subPath: null,
				services: ["checkout"],
			};

			const found = await listRunbooks([manyRepo], { limit: 50 });
			expect(found).toHaveLength(50);
			expect(found.every((e) => e.origin === "repo")).toBe(true);
			// catalog-info.yaml requires git show; because limit stopped early, no catalog entries exist
			expect(found.some((e) => e.matchedBy === "catalog-info.yaml")).toBe(false);
		} finally {
			rmSync(manyDir, { recursive: true, force: true });
		}
	});

	it("a git runner that settles only on abort rejects within 1 s (#848)", async () => {
		const ac = new AbortController();
		ac.abort(new Error("scan aborted"));
		const startedAt = Date.now();
		await expect(
			listRunbooks([repo], { signal: ac.signal }),
		).rejects.toThrow("scan aborted");
		expect(Date.now() - startedAt).toBeLessThan(1000);
	});
});

describe("readRunbook", () => {
	it("returns the markdown of a listed path", async () => {
		const r = await readRunbook([repo], "api/runbooks/db-failover.md", "checkout");
		expect(r).toEqual({
			ok: true,
			path: "api/runbooks/db-failover.md",
			markdown: "# DB failover\nPromote the replica.",
		});
	});

	it("caps a long runbook", async () => {
		const r = await readRunbook([repo], "api/runbooks/big.md", "checkout");
		expect(r.ok && "markdown" in r && r.markdown.length).toBeLessThan(
			RUNBOOK_CHARS + 100,
		);
		expect(r.ok && "markdown" in r && r.markdown).toContain("[truncated");
	});

	it("returns a catalog link as a link and never fetches it", async () => {
		const url = "https://wiki.example.com/checkout-runbook";
		expect(await readRunbook([repo], url, "checkout")).toEqual({
			ok: true,
			path: url,
			link: url,
		});
	});

	it.each([
		"api/secret.md",
		"api/../secret.md",
		"../etc/passwd",
		"api/runbooks/../secret.md",
		"api/runbooks/uncommitted.md",
		"api/docs/guide.md",
		"/etc/passwd",
		"api/runbooks/",
	])("refuses %s, which the list never returned", async (path) => {
		const r = await readRunbook([repo], path, "checkout");
		expect(r.ok).toBe(false);
	});

	it("refuses a service the repo is not bound to", async () => {
		expect(
			(await readRunbook([repo], "api/runbooks/db-failover.md", "billing")).ok,
		).toBe(false);
	});
});
