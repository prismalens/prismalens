// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	ACP_REGISTRY,
	AcpRegistrySchema,
	installLineFor,
	parseAcpRegistry,
} from "./acp-registry.js";
import bundled from "./acp-registry.json" with { type: "json" };
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

	it("keeps registry text inert: unsafe args, schemes and install lines are dropped (#848)", () => {
		expect(
			installOf({ npx: { package: "pkg", args: ["'; echo INJECTED; #"] } }),
		).toEqual([]);
		expect(installOf({ uvx: { package: "-e", args: [] } })).toEqual([]);
		expect(
			installOf({
				binary: {
					a: { archive: "javascript:alert(1)" },
					b: { archive: "http://example.com/b.tgz" },
					c: { archive: "https://example.com/c.tgz;rm" },
					"d e": { archive: "https://example.com/d.tgz" },
					ok: { archive: "https://example.com/ok.tgz" },
				},
			}),
		).toEqual(["ok: https://example.com/ok.tgz"]);

		const entry = (install: string[]) => ({
			id: "x",
			name: "X",
			description: "",
			install,
		});
		expect(
			parseAcpRegistry([
				entry(["npx -y pkg --acp"]),
				entry(["npx -y pkg ''; echo INJECTED; #'"]),
				entry(["npx -y pkg\nrm -rf ~"]),
				entry(["linux: javascript:alert(1)"]),
				entry(["linux: http://example.com/a.tgz"]),
			]),
		).toEqual([entry(["npx -y pkg --acp"])]);
		expect(ACP_REGISTRY).toHaveLength(bundled.length);
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

describe("acpRegistryIds (#911)", () => {
	it("names only entries the bundled registry has", () => {
		const ids = new Set(ACP_REGISTRY.map((e) => e.id));
		const named = Object.values(HARNESS_REGISTRY).flatMap(
			(d) => d.acpRegistryIds ?? [],
		);
		expect(named.length).toBeGreaterThan(0);
		for (const id of named) expect(ids.has(id)).toBe(true);
	});
});

describe("installLineFor (#1180)", () => {
	const goose = {
		id: "goose",
		name: "goose",
		description: "",
		install: [
			"darwin-aarch64: https://example.test/goose-aarch64-apple-darwin.tar.bz2",
			"linux-x86_64: https://example.test/goose-x86_64-unknown-linux-gnu.tar.bz2",
			"linux-x86_64-musl: https://example.test/goose-x86_64-unknown-linux-musl.tar.bz2",
			"linux-aarch64-musl: https://example.test/goose-aarch64-unknown-linux-musl.tar.bz2",
			"windows-x86_64: https://example.test/goose-x86_64-pc-windows-msvc.zip",
		],
	};

	it("gives this host's archive, glibc before musl, musl when it is the only build", () => {
		expect(installLineFor(goose, "linux", "x64")).toEqual({
			line: "https://example.test/goose-x86_64-unknown-linux-gnu.tar.bz2",
		});
		expect(installLineFor(goose, "darwin", "arm64")).toEqual({
			line: "https://example.test/goose-aarch64-apple-darwin.tar.bz2",
		});
		expect(installLineFor(goose, "win32", "x64")).toEqual({
			line: "https://example.test/goose-x86_64-pc-windows-msvc.zip",
		});
		expect(installLineFor(goose, "linux", "arm64")).toEqual({
			line: "https://example.test/goose-aarch64-unknown-linux-musl.tar.bz2",
		});
	});

	it("names the host when it has no build", () => {
		expect(installLineFor(goose, "win32", "arm64")).toEqual({
			none: "No build for windows aarch64",
		});
	});

	it("prefers a package command, which runs on any host", () => {
		expect(
			installLineFor(
				{ ...goose, install: [goose.install[0] as string, "npx -y @x/agent@1.0.0"] },
				"win32",
				"arm64",
			),
		).toEqual({ line: "npx -y @x/agent@1.0.0" });
	});
});
