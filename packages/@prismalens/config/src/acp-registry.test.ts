// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { ACP_REGISTRY, AcpRegistrySchema } from "./acp-registry.js";
import { HARNESS_REGISTRY } from "./providers/harness.js";
import { listHarnessStatus } from "./harness-selection.js";
// @ts-expect-error script helper module
import { installOf, snapshotOf } from "../../../../scripts/acp-registry-snapshot.mjs";

describe("ACP Registry and toolsHint (#848 C17)", () => {
	it("ACP_REGISTRY parses against AcpRegistrySchema", () => {
		expect(ACP_REGISTRY.length).toBeGreaterThan(0);
		expect(AcpRegistrySchema.safeParse(ACP_REGISTRY).success).toBe(true);
		for (const entry of ACP_REGISTRY) {
			expect(entry.id).toBeTruthy();
			expect(entry.name).toBeTruthy();
			expect(entry.install.length).toBeGreaterThan(0);
		}
	});

	it("installOf generates npx, uvx, and binary install commands", () => {
		expect(
			installOf({
				npx: { package: "@modelcontextprotocol/server-sqlite", args: ["--db", "test.db"] },
			}),
		).toEqual(["npx -y @modelcontextprotocol/server-sqlite --db test.db"]);

		expect(
			installOf({
				uvx: { package: "mcp-server-git", args: ["--repo", "."] },
			}),
		).toEqual(["uvx mcp-server-git --repo ."]);

		expect(
			installOf({
				binary: {
					"darwin-arm64": { archive: "https://example.com/bin-arm64.tar.gz" },
					"linux-x64": { archive: "https://example.com/bin-linux.tar.gz" },
				},
			}),
		).toEqual([
			"darwin-arm64: https://example.com/bin-arm64.tar.gz",
			"linux-x64: https://example.com/bin-linux.tar.gz",
		]);
	});

	it("snapshotOf drops entries without install lines and throws without agents array", () => {
		expect(() => snapshotOf(null as any)).toThrow("the registry has no agents array");
		expect(() => snapshotOf({} as any)).toThrow("the registry has no agents array");

		const raw = {
			agents: [
				{
					id: "a1",
					name: "Agent 1",
					description: "desc 1",
					distribution: { npx: { package: "pkg1" } },
				},
				{
					id: "a2",
					name: "Agent 2",
					description: "no distribution",
					distribution: {},
				},
			],
		};

		const snap = snapshotOf(raw);
		expect(snap).toHaveLength(1);
		expect(snap[0]).toEqual({
			id: "a1",
			name: "Agent 1",
			description: "desc 1",
			install: ["npx -y pkg1"],
		});
	});

	it("toolsHint is defined on gemini and listed in listHarnessStatus for gemini only", () => {
		expect(HARNESS_REGISTRY["gemini"].toolsHint?.text).toBe(
			"If you use Gemini's folder trust, trust the runs folder to give it PrismaLens's tools",
		);
		expect(HARNESS_REGISTRY["claude-code"].toolsHint).toBeUndefined();
		expect(HARNESS_REGISTRY["codex"].toolsHint).toBeUndefined();

		const statuses = listHarnessStatus({ env: {} });
		const geminiStatus = statuses.find((s) => s.id === "gemini");
		const claudeStatus = statuses.find((s) => s.id === "claude-code");

		expect(geminiStatus?.toolsHint?.text).toBe(
			"If you use Gemini's folder trust, trust the runs folder to give it PrismaLens's tools",
		);
		expect(claudeStatus?.toolsHint).toBeUndefined();
	});
});
