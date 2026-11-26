// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What loads and the PrismaLens set (#1180 §3.1, §3.3) over a temp SQLite database and scratch agent homes. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-agent-setup-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME"])
		delete process.env[k];
	return { root };
});

const { PrismaService } = await import("../prisma/prisma.service.js");
const { CredentialsService } = await import(
	"../../modules/integrations/crypto/credentials.service.js"
);
const { AgentSetupService, SHARED_SERVERS_KEY } = await import(
	"./agent-setup.service.js"
);
import type { HarnessService } from "./harness.service.js";

vi.setConfig({ testTimeout: 15_000 });

const SECRET = "S3NTINEL-value";
const ARG = "arg-sentinel-path";

let prisma: InstanceType<typeof PrismaService>;
let service: InstanceType<typeof AgentSetupService>;
let installed = ["claude-code", "codex"];
const home = join(env.root, "home");
const bin = join(env.root, "bin");
const command = join(bin, "docs-mcp");

beforeAll(async () => {
	const { resolveMigrationsDir, runMigrations } = await import(
		"@prismalens/database/migrator"
	);
	await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
	prisma = new PrismaService();
	await prisma.$connect();
	const credentials = new CredentialsService({
		get: (key: string) =>
			key === "PRISMALENS_ENCRYPTION_KEY" ? "ab".repeat(32) : undefined,
	} as unknown as ConstructorParameters<typeof CredentialsService>[0]);
	const harness = {
		runtimeFor: async () => ({ env: { HOME: home, USERPROFILE: home } }),
		installedIds: async () => installed,
	} as unknown as HarnessService;
	service = new AgentSetupService(prisma, harness, credentials);
	mkdirSync(bin, { recursive: true });
	writeFileSync(command, "marker-A");
	mkdirSync(home, { recursive: true });
	writeFileSync(
		join(home, ".claude.json"),
		JSON.stringify({
			mcpServers: {
				docs: { command, args: ["--root", ARG], env: { TOKEN: SECRET } },
				web: { type: "http", url: `https://u:p@mcp.example/v1/${ARG}?key=${SECRET}#f` },
			},
		}),
	);
});

afterAll(async () => {
	await prisma.$disconnect();
	rmSync(env.root, { recursive: true, force: true });
});

const docsDef = {
	type: "stdio" as const,
	command,
	args: ["--root", ARG, { value: "DB" }],
	env: ["TOKEN"],
};

describe("the PrismaLens set (#1180 §3.3)", () => {
	it("stores the server only encrypted, and no view returns an argument, a URL path or a value", async () => {
		await service.approveSharedServer({
			name: "docs",
			def: docsDef,
			values: { TOKEN: SECRET, DB: SECRET },
			recipients: ["claude-code", "codex"],
			from: null,
		});
		await service.approveSharedServer({
			name: "web",
			def: { type: "http", url: `https://mcp.example/v1/${ARG}`, query: ["key"], headers: [] },
			values: { key: SECRET },
			recipients: ["claude-code"],
			from: null,
		});
		const row = await prisma.setting.findUnique({ where: { key: SHARED_SERVERS_KEY } });
		expect([row?.type, row?.value.includes(SECRET), row?.value.includes(ARG)]).toEqual(["encrypted", false, false]);
		const set = await service.sharedSet();
		const shown = JSON.stringify(set);
		expect([shown.includes(SECRET), shown.includes(ARG), shown.includes("/v1")]).toEqual([false, false, false]);
		expect(set.servers.map((s) => [s.name, s.transport, s.command, s.argCount, s.host, s.missingValues])).toEqual([
			["docs", "stdio", "docs-mcp", 3, null, []],
			["web", "http", null, 0, "mcp.example", []],
		]);
	});

	it("approving a changed URL without values leaves it Needs values and undelivered", async () => {
		await service.approveSharedServer({
			name: "web",
			def: { type: "http", url: "https://mcp.example/v2", query: ["key"], headers: [] },
			values: {},
			recipients: ["claude-code"],
			from: null,
		});
		const web = (await service.sharedSet()).servers.find((s) => s.name === "web");
		expect(web?.missingValues).toEqual(["key"]);
		const loadout = await service.loadout({ id: "claude-code" });
		expect(loadout.items.find((i) => i.name === "pl-web")).toMatchObject({ state: "not-sent", note: "Not sent: needs values" });
		expect(loadout.items.find((i) => i.name === "pl-docs")).toMatchObject({ state: "loads", scope: "prismalens" });
	});

	it("an agent installed after approval is not a recipient until the person adds it", async () => {
		installed = ["claude-code", "codex", "gemini"];
		const before = await service.loadout({ id: "gemini" });
		expect(before.items.find((i) => i.name === "pl-docs")?.note).toBe("Not a recipient");
		await service.setMembership("gemini", true);
		const docs = (await service.sharedSet()).servers.find((s) => s.name === "docs");
		expect(docs?.recipients).toEqual(["claude-code", "codex", "gemini"]);
	});

	it("the preview masks every argument and the URL path, and never returns sign-in, query or fragment", async () => {
		const sources = await service.sharedSources();
		expect(sources.filter((s) => s.agent === "claude-code").map((s) => [s.key, s.transport])).toEqual([
			["docs", "stdio"],
			["web", "http"],
		]);
		const web = await service.preview({ agent: "claude-code", path: join(home, ".claude.json"), key: "web" });
		expect(web).toEqual({
			source: { agent: "claude-code", path: join(home, ".claude.json"), key: "web" },
			transport: "http",
			command: null,
			args: [],
			origin: "https://mcp.example",
			hasPath: true,
			removed: ["sign-in", "query", "fragment"],
			env: [],
			headers: [],
		});
		const docs = await service.preview({ agent: "claude-code", path: join(home, ".claude.json"), key: "docs" });
		expect([docs.args, docs.env, JSON.stringify(docs).includes(ARG)]).toEqual([[null, null], ["TOKEN"], false]);
		expect(await service.reveal({ source: docs.source, row: 1 })).toEqual({ value: ARG });
		expect(await service.reveal({ source: web.source, row: "path" })).toEqual({ value: `/v1/${ARG}` });
	});
});

describe("What loads merges only a matching session's report (#1180 §3.1)", () => {
	const project = join(env.root, "project");
	let repositoryId = "";
	let n = 0;

	async function reportOn(fingerprint: string, profile: "own" | "clean") {
		const inv = await prisma.investigation.create({
			data: { harness: "claude-code", repositoryId },
		});
		await prisma.investigationEvent.create({
			data: {
				investigationId: inv.id,
				seq: n++,
				branchId: "main",
				event: JSON.stringify({
					kind: "agent_loadout",
					profile,
					cwd: project,
					fingerprint,
					items: [
						{ kind: "mcp", name: "db", scope: "repo", path: join(project, ".mcp.json"), disk: true, reported: null, state: "failed" },
						{ kind: "plugin", name: "lint@m", scope: "plugin", path: null, disk: true, reported: null, state: "loads" },
						{ kind: "mcp", name: "docs", scope: "global", path: null, disk: true, reported: null, state: "loads" },
					],
				}),
			},
		});
		return inv.id;
	}

	beforeAll(async () => {
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db" } } }));
		repositoryId = (await prisma.repository.create({ data: { fullName: "local/project", url: project } })).id;
	});

	it("merges the newest own-profile report whose fingerprint matches; a clean-profile view ignores it", async () => {
		const view = await service.loadout({ id: "claude-code", repositoryId });
		const { configFingerprint } = await import("@prismalens/engine");
		expect(view.report).toBeNull();
		const set = await service.sharedSet();
		const fp = configFingerprint("claude-code", { ...process.env, HOME: home, USERPROFILE: home }, project, {
			profile: "own",
			isolation: null,
			sharedRevision: set.revision,
			member: set.instructionsFor.includes("claude-code"),
		});
		const thread = await reportOn(fp, "own");
		const merged = await service.loadout({ id: "claude-code", repositoryId });
		expect(merged.report?.threadId).toBe(thread);
		expect(merged.items.find((i) => i.name === "db")).toMatchObject({ disk: true, state: "failed", scope: "repo" });
		expect(merged.items.find((i) => i.name === "lint@m")).toMatchObject({ disk: false, state: "loads" });
		// Claude's init gives no path: its row merges into the disk row by kind and name.
		expect(merged.items.filter((i) => i.name === "docs").map((i) => [i.disk, i.state, i.path])).toEqual([
			[true, "loads", join(home, ".claude.json")],
		]);
		const clean = await service.loadout({ id: "claude-code", repositoryId, profile: "clean" });
		expect([clean.report, clean.staleReport, clean.items.some((i) => i.name === "lint@m")]).toEqual([null, null, false]);
	});

	it("a config edit after the last run drops the merge and points at that run as a different setup", async () => {
		const last = await service.loadout({ id: "claude-code", repositoryId });
		writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db2" } } }));
		const after = await service.loadout({ id: "claude-code", repositoryId });
		expect(after.report).toBeNull();
		expect(after.staleReport?.threadId).toBe(last.report?.threadId);
		expect(after.items.find((i) => i.name === "db")).toMatchObject({ state: "in-project", reported: null });
	});
});
