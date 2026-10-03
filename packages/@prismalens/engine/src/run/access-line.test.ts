// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { PERMISSION_MODES, type PermissionMode } from "@prismalens/config/harness";
import { ACCESS_LABEL, ACCESS_LINE } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { telemetryOrigins } from "./connectors.js";
import { type PermissionRequest, readOnlyPolicyFor } from "./permission.js";

/**
 * The drift guard round 3 asked for (r4 R4.1 rev): what each access line says
 * PrismaLens refuses is checked against the red-team corpus, never against the
 * policy's own tables. A phrase names corpus classes; every instance of them must be refused.
 */
const REFUSAL_PHRASES: [phrase: string, classes: string[]][] = [
	["writes outside the copy", ["write-outside"]],
	["writes", ["file-write", "write-outside"]],
	["installs", ["installer"]],
	["other addresses", ["host-outside-brief", "schemeless-url"]],
	["request bodies", ["request-body"]],
	[
		"other ways out",
		[
			"request-routing",
			"request-body",
			"network-client",
			"interpreter-on-file",
			"second-interpreter",
			"command-spawning",
			"downloaders",
			"git-remote",
			"credential-path",
			"outside-snapshot",
			"fetch-kind",
			"cluster-write",
			"machine-control",
		],
	],
];
/** Edit the copy lets an output file land in the copy, which class 2 counts as routing below it. */
const GRANTED_BY_LINE: Partial<Record<PermissionMode, string[]>> = {
	"workspace-write": ["request-routing"],
};

interface Instance {
	class: string;
	kind?: string;
	command?: string;
	path?: string;
	expect: Record<PermissionMode, "allow" | "refuse">;
}
const corpus = JSON.parse(
	readFileSync(new URL("./__fixtures__/red-team-corpus.json", import.meta.url), "utf8"),
) as {
	brief: { prometheusUrl: string; alertmanagerUrl: string; apiUrl: string; logsUrl: string };
	instances: Instance[];
};

/** The classes a line claims to refuse: the longest phrase wins, so "writes outside the copy" is not "writes". */
function claimed(line: string): string[] {
	let rest = line;
	const out = new Set<string>();
	for (const [phrase, classes] of REFUSAL_PHRASES) {
		if (!rest.includes(phrase)) continue;
		rest = rest.replaceAll(phrase, "");
		for (const c of classes) out.add(c);
	}
	return [...out];
}

describe("ACCESS_LINE against the red-team corpus (r4 R4.1 rev)", () => {
	it("has a label and a line for every level", () => {
		for (const level of PERMISSION_MODES) {
			expect(ACCESS_LABEL[level].length, level).toBeGreaterThan(0);
			expect(ACCESS_LINE[level].length, level).toBeGreaterThan(0);
		}
		expect(ACCESS_LINE["read-only"]).toBe(
			"Reads the copied code and queries the telemetry addresses in the brief. PrismaLens refuses writes, installs, other addresses and other ways out that it can see. A guardrail for an honest agent, not a sandbox.",
		);
	});

	it.each(PERMISSION_MODES)("%s: the line uses no absolute word", (level) => {
		expect(ACCESS_LINE[level]).not.toMatch(/\bnever\b|\bonly\b|without sending/i);
	});

	it.each(PERMISSION_MODES)("%s: every class the line says it refuses has no allowed instance", (level) => {
		const classes = claimed(ACCESS_LINE[level]).filter((c) => !GRANTED_BY_LINE[level]?.includes(c));
		if (level !== "full-access") expect(classes.length, level).toBeGreaterThan(0);
		const policy = readOnlyPolicyFor({
			cwd: "/work/runs/abc/repo",
			level,
			allowedOrigins: telemetryOrigins({
				telemetry: {
					prometheusUrl: corpus.brief.prometheusUrl,
					alertmanagerUrl: corpus.brief.alertmanagerUrl,
					apiUrl: corpus.brief.apiUrl,
				},
				logs: { url: corpus.brief.logsUrl },
			}),
		});
		for (const cls of classes) {
			const instances = corpus.instances.filter((i) => i.class === cls);
			expect(instances.length, cls).toBeGreaterThan(0);
			for (const i of instances) {
				const rawInput: Record<string, string> = {};
				if (i.command !== undefined) rawInput.command = i.command;
				if (i.path !== undefined) rawInput.filePath = i.path;
				const request: PermissionRequest = {
					options: [
						{ optionId: "once", kind: "allow_once" },
						{ optionId: "reject", kind: "reject_once" },
					],
					toolCall: { kind: i.kind ?? "execute", title: i.command ?? "", rawInput },
				};
				const label = `${level} ${cls}: ${i.command ?? i.path ?? i.kind}`;
				expect(i.expect[level], label).toBe("refuse");
				expect(policy(request).allow, label).toBe(false);
			}
		}
	});
});
