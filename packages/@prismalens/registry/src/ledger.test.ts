// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { appendLedger, ledgerDiff, ledgerProblems, parseLedger } from "./ledger.ts";
import type { ManifestEntry } from "./manifest.ts";

const entry = (id: string, stored: unknown[], aliases: string[] = []): ManifestEntry => ({
	id,
	file: "src/x.provider.ts",
	export: "x",
	fields: { stored, aliases } as ManifestEntry["fields"],
});

const github = entry("code-host.github", [
	{ column: "Integration.templateId", value: "git-host-token", where: { field: "host", value: "github.com" } },
	{ column: "PullRequest.host", value: "github" },
]);
const gitlab = entry("code-host.gitlab", [
	{ column: "Integration.templateId", value: "git-host-token", where: { field: "host", value: "gitlab.com" } },
]);

const LEDGER = [
	"Integration.templateId\tgit-host-token\tcode-host.github\thost=github.com",
	"PullRequest.host\tgithub\tcode-host.github",
	"Integration.templateId\tgit-host-token\tcode-host.gitlab\thost=gitlab.com",
].join("\n");

describe("ledgerProblems", () => {
	it("holds when every row is claimed by its owner and every claim has its row", () => {
		expect(ledgerProblems(parseLedger(LEDGER).rows, [github, gitlab], "stored")).toEqual([]);
	});

	it("names a takeover of a shared value by another member, though the ledger is untouched", () => {
		const thief = entry("code-host.gitlab", [
			{ column: "Integration.templateId", value: "git-host-token", where: { field: "host", value: "github.com" } },
			{ column: "Integration.templateId", value: "git-host-token", where: { field: "host", value: "gitlab.com" } },
		]);
		const notGithub = entry("code-host.github", [{ column: "PullRequest.host", value: "github" }]);
		expect(ledgerProblems(parseLedger(LEDGER).rows, [notGithub, thief], "stored")).toEqual([
			"code-host.gitlab claims Integration.templateId=git-host-token (host=github.com), which the ledger gives to code-host.github",
		]);
	});

	it("names a shipped value nothing claims any more, and a claim with no row yet", () => {
		const dropped = entry("code-host.github", [{ column: "PullRequest.host", value: "gh" }]);
		expect(ledgerProblems(parseLedger(LEDGER).rows, [dropped, gitlab], "stored")).toEqual([
			"the database may hold Integration.templateId=git-host-token (host=github.com) for code-host.github, but no entry claims it",
			"the database may hold PullRequest.host=github for code-host.github, but no entry claims it",
			"code-host.github claims PullRequest.host=gh, which is not in the ledger yet",
		]);
	});

	it("lets a renamed member keep its rows through an alias", () => {
		const renamed = entry(
			"code-host.github-cloud",
			[
				{ column: "Integration.templateId", value: "git-host-token", where: { field: "host", value: "github.com" } },
				{ column: "PullRequest.host", value: "github" },
			],
			["code-host.github"],
		);
		expect(ledgerProblems(parseLedger(LEDGER).rows, [renamed, gitlab], "stored")).toEqual([]);
	});
});

describe("appendLedger", () => {
	it("appends a row per new claim and never rewrites an existing one", () => {
		const start = "Integration.templateId\tgit-host-token\tcode-host.github\thost=github.com\n";
		expect(appendLedger(start, [github], "stored")).toBe(`${start}PullRequest.host\tgithub\tcode-host.github\n`);
		expect(appendLedger(LEDGER, [github, gitlab], "stored")).toBe(LEDGER);
	});
});

describe("ledgerDiff", () => {
	it("names a removed row and a moved owner, and nothing for an appended row", () => {
		const head = [
			"Integration.templateId\tgit-host-token\tcode-host.gitlab\thost=github.com",
			"Integration.templateId\tgit-host-token\tcode-host.gitlab\thost=gitlab.com",
			"Run.harness\tclaude-code\tagent.claude-code",
		].join("\n");
		expect(ledgerDiff(LEDGER, head)).toEqual([
			"ledger row Integration.templateId=git-host-token (host=github.com) moved from code-host.github to code-host.gitlab",
			"ledger row PullRequest.host=github (code-host.github) was removed",
		]);
	});
});

describe("parseLedger", () => {
	it("skips comments and blanks and names a short row by line", () => {
		expect(parseLedger("# header\n\nA\tb\n").problems).toEqual(["ledger line 3 needs column, value and owner"]);
	});
});
