// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What loads and the PrismaLens set (#1180 §3.1, §3.3) over a temp SQLite database and scratch agent homes. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { GATEWAY_RUN_FILE } from "@prismalens/agent-host";
import { mcpSourceHash, prepareRunEnv, readMcpSource } from "@prismalens/engine";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

// What Codex's own CLI says it loads; no CLI runs in this suite, so each test sets it.
const codexSaid = vi.hoisted(() => ({ items: null as unknown[] | null }));
vi.mock("@prismalens/engine", async (load) => ({
	...(await load<typeof import("@prismalens/engine")>()),
	readAgentLoadout: async (id: string) => (id === "codex" ? codexSaid.items : null),
}));

const { PrismaService } = await import("../prisma/prisma.service.js");
const { CredentialsService } = await import(
	"../../modules/integrations/crypto/credentials.service.js"
);
const { AgentSetupService, AgentSetupError, SHARED_SERVERS_KEY, SHARED_SET_KEY } = await import(
	"./agent-setup.service.js"
);
import type { HarnessModelsService } from "./harness-models.service.js";
import type { HarnessService } from "./harness.service.js";

vi.setConfig({ testTimeout: 15_000 });

const SECRET = "S3NTINEL-value";
const ARG = "arg-sentinel-path";

let prisma: InstanceType<typeof PrismaService>;
let service: InstanceType<typeof AgentSetupService>;
let installed = ["claude-code", "codex"];
/** What each agent's last check said of `mcpCapabilities.http`; absent: never checked. */
const httpById: Record<string, boolean> = {};
const home = join(env.root, "home");
const bin = join(env.root, "bin");
const command = join(bin, "docs-mcp");
const claudeJson = join(home, ".claude.json");

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
	const models = {
		checked: (id: string) => (id in httpById ? { mcpHttp: httpById[id] } : undefined),
	} as unknown as HarnessModelsService;
	service = new AgentSetupService(prisma, harness, credentials, models);
	mkdirSync(bin, { recursive: true });
	writeFileSync(command, "marker-A");
	mkdirSync(home, { recursive: true });
	writeFileSync(
		claudeJson,
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

/** Each case starts from no set and no recorded sessions. */
beforeEach(async () => {
	installed = ["claude-code", "codex"];
	await prisma.setting.deleteMany({ where: { key: { in: [SHARED_SERVERS_KEY, SHARED_SET_KEY] } } });
	await prisma.investigationEvent.deleteMany({});
});

const docsDef = {
	type: "stdio" as const,
	command,
	args: ["--root", ARG, { value: "DB" }],
	env: ["TOKEN"],
};
const approveDocs = (recipients = ["claude-code", "codex"]) =>
	service.approveSharedServer({ name: "docs", def: docsDef, values: { TOKEN: SECRET, DB: SECRET }, recipients, from: null });
const approveWeb = (path: string, values: Record<string, string>, recipients = ["claude-code"], query = ["key"]) =>
	service.approveSharedServer({
		name: "web",
		def: { type: "http", url: `https://mcp.example${path}`, query, headers: [] },
		values,
		recipients,
		from: null,
	});
const names = async () => (await service.sharedSet()).servers.map((s) => s.name);
const refused = (message: string) => new AgentSetupError("BAD_REQUEST", message);

describe("the PrismaLens set (#1180 §3.3)", () => {
	it("stores the server only encrypted, and no view returns an argument, a URL path or a value", async () => {
		await approveDocs();
		await approveWeb(`/v1/${ARG}`, { key: SECRET });
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

	it("reads a server stored with an empty copied-from key as copied from no entry, so the set still loads", async () => {
		const path = join(env.root, "no-such-config.json");
		await service.approveSharedServer({
			name: "docs",
			def: docsDef,
			values: { TOKEN: SECRET, DB: SECRET },
			recipients: ["codex"],
			from: { agent: "claude-code", path, key: "", revision: mcpSourceHash(readMcpSource("claude-code", {}, path, "")) },
		});
		expect((await service.sharedSet()).servers.map((s) => [s.name, s.fromAgent, s.fromSource])).toEqual([["docs", "claude-code", null]]);
	});

	it("approving a changed URL without values leaves it Needs values and undelivered", async () => {
		await approveDocs();
		await approveWeb("/v1", { key: SECRET });
		const first = await service.loadout({ id: "claude-code" });
		expect(first.items.find((i) => i.name === "pl-web")).toMatchObject({ state: "unknown", scope: "prismalens" });
		await approveWeb("/v2", {});
		const web = (await service.sharedSet()).servers.find((s) => s.name === "web");
		expect(web?.missingValues).toEqual(["key"]);
		const loadout = await service.loadout({ id: "claude-code" });
		expect(loadout.items.find((i) => i.name === "pl-web")).toMatchObject({ state: "not-sent", note: "Not sent: needs values" });
		expect(loadout.items.find((i) => i.name === "pl-docs")).toMatchObject({ state: "loads", scope: "prismalens" });
	});

	it("an HTTP server shows Not sent: no HTTP, and is not delivered, to an agent whose check said it takes none", async () => {
		await approveDocs();
		await service.approveSharedServer({
			name: "web",
			def: { type: "http", url: "https://mcp.example/v3", query: [], headers: [] },
			values: {},
			recipients: ["claude-code", "codex"],
			from: null,
		});
		httpById.codex = false;
		httpById["claude-code"] = true;
		try {
			const items = async (id: string) => (await service.loadout({ id })).items.find((i) => i.name === "pl-web");
			expect([await items("codex"), await items("claude-code")]).toMatchObject([
				{ state: "not-sent", note: "Not sent: no HTTP" },
				{ state: "loads" },
			]);
			const run = async (id: "codex" | "claude-code") => (await service.forRun(id, env.root))?.servers.map((s) => s.name);
			expect([await run("codex"), await run("claude-code")]).toEqual([["pl-docs"], ["pl-docs", "pl-web"]]);
		} finally {
			delete httpById.codex;
			delete httpById["claude-code"];
		}
	});

	it("an agent installed after approval is not a recipient until the person adds it", async () => {
		await approveDocs();
		installed = ["claude-code", "codex", "gemini"];
		const before = await service.loadout({ id: "gemini" });
		expect(before.items.find((i) => i.name === "pl-docs")?.note).toBe("Not a recipient");
		await service.setMembership("gemini", true);
		const docs = (await service.sharedSet()).servers.find((s) => s.name === "docs");
		expect(docs?.recipients).toEqual(["claude-code", "codex", "gemini"]);
	});

	it("refuses a secret in argument 3 that looks like a path (relative, absolute or a base64 token with a slash), and stores nothing", async () => {
		const outcomes = await Promise.all(
			["scripts/server.js", command, "ab+c/de=="].map((DB) =>
				service
					.approveSharedServer({ name: "docs", def: docsDef, values: { TOKEN: SECRET, DB }, recipients: [], from: null })
					.then(() => "approved", (e: unknown) => e),
			),
		);
		const no = refused("Argument 3 holds a secret that looks like a path; move it to an environment variable");
		expect([outcomes, await names()]).toEqual([[no, no, no], []]);
	});

	it("does not send a node server whose script is relative to the run's folder, and What loads says it needs an absolute script path", async () => {
		const ws = join(env.root, "node-ws");
		mkdirSync(join(ws, "server"), { recursive: true });
		writeFileSync(join(ws, "server", "index.js"), "x");
		const node = join(bin, "node");
		writeFileSync(node, "x");
		const def = { type: "stdio" as const, command: node, args: ["server"], env: [] };
		await service.approveSharedServer({ name: "nodes", def, values: {}, recipients: ["claude-code"], from: null });
		const repositoryId = (await prisma.repository.create({ data: { fullName: "local/node-ws", url: ws } })).id;
		const run = await service.forRun("claude-code", ws);
		const view = await service.loadout({ id: "claude-code", repositoryId });
		expect([run.servers, view.items.find((i) => i.name === "pl-nodes")?.note]).toEqual([
			[],
			"Needs an absolute script path",
		]);
	});

	it("holds back a node server whose secret argument names a script in the run's folder, and the secret is in neither the run's share nor What loads", async () => {
		const secret = "srv-7f3a9c";
		const ws = join(env.root, "node-secret-ws");
		mkdirSync(ws, { recursive: true });
		writeFileSync(join(ws, `${secret}.js`), "x");
		const node = join(bin, "node");
		writeFileSync(node, "x");
		const def = { type: "stdio" as const, command: node, args: [{ value: "SCRIPT" }], env: [] };
		await service.approveSharedServer({ name: "nodes", def, values: { SCRIPT: secret }, recipients: ["claude-code"], from: null });
		const repositoryId = (await prisma.repository.create({ data: { fullName: "local/node-secret-ws", url: ws } })).id;
		const run = await service.forRun("claude-code", ws);
		const view = await service.loadout({ id: "claude-code", repositoryId });
		expect([
			run.servers,
			run.hidden,
			view.items.find((i) => i.name === "pl-nodes")?.note,
			JSON.stringify([run, view]).includes(secret),
		]).toEqual([[], [], "Needs an absolute script path", false]);
	});

	it("offers an approved HTTP server to the run, and What loads shows it as sent only if the agent takes HTTP", async () => {
		const cwd = join(env.root, "http-ws");
		mkdirSync(cwd, { recursive: true });
		await approveDocs(["claude-code"]);
		await approveWeb("/v1", { key: SECRET });
		const run = await service.forRun("claude-code", cwd);
		const items = (await service.loadout({ id: "claude-code" })).items.filter((i) => i.scope === "prismalens");
		expect([run.servers.map((m) => m.name).sort(), items.map((i) => [i.name, i.state, i.note ?? null])]).toEqual([
			["pl-docs", "pl-web"],
			[
				["pl-docs", "loads", null],
				["pl-web", "unknown", "Sent if the agent takes HTTP"],
			],
		]);
	});

	it("refuses an approved URL that carries sign-in, a query or a fragment", async () => {
		const urls = ["https://u:p@mcp.example/v1", "https://mcp.example/v1?key=x", "https://mcp.example/v1#f"];
		const outcomes = await Promise.all(
			urls.map((url) =>
				service
					.approveSharedServer({ name: "web", def: { type: "http", url, query: [], headers: [] }, values: {}, recipients: [], from: null })
					.then(() => "approved", (e: unknown) => e),
			),
		);
		const no = refused("The URL holds only its origin and path; a query part is a value");
		expect([outcomes, await names()]).toEqual([[no, no, no], []]);
	});

	it("an approval running beside a removal does not bring the removed server back", async () => {
		await approveDocs();
		await Promise.all([approveWeb("/v1", { key: SECRET }), service.removeSharedServer("docs")]);
		expect(await names()).toEqual(["web"]);
	});

	it("two approvals at once keep both servers", async () => {
		await Promise.all([approveDocs(), approveWeb("/v1", { key: SECRET })]);
		expect((await names()).sort()).toEqual(["docs", "web"]);
	});

	it("a membership change whose second write fails leaves servers and instructions as they were", async () => {
		await approveDocs(["claude-code"]);
		type Interactive = (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
		const real = prisma.$transaction.bind(prisma) as Interactive;
		const failing: Interactive = (fn) =>
			real(async (tx) => {
				const t = tx as { setting: { upsert: (a: unknown) => Promise<unknown> } };
				let writes = 0;
				const setting = new Proxy(t.setting, {
					get: (target, k) =>
						k === "upsert"
							? (a: unknown) => (++writes === 2 ? Promise.reject(new Error("disk full")) : target.upsert(a))
							: Reflect.get(target, k),
				});
				return fn({ setting });
			});
		vi.spyOn(prisma, "$transaction").mockImplementationOnce(failing as typeof prisma.$transaction);
		await expect(service.setMembership("codex", true)).rejects.toThrow("disk full");
		const set = await service.sharedSet();
		expect([set.servers[0]?.recipients, set.instructionsFor]).toEqual([["claude-code"], []]);
	});

	it("refuses a 33rd server, and still replaces one of 32", async () => {
		for (let i = 0; i < 32; i++)
			await service.approveSharedServer({ name: `s${i}`, def: docsDef, values: {}, recipients: [], from: null });
		await expect(
			service.approveSharedServer({ name: "s32", def: docsDef, values: {}, recipients: [], from: null }),
		).rejects.toEqual(refused("The PrismaLens set holds at most 32 servers"));
		await service.approveSharedServer({ name: "s0", def: docsDef, values: {}, recipients: ["codex"], from: null });
		const set = await service.sharedSet();
		expect([set.servers.length, set.servers.find((s) => s.name === "s0")?.recipients]).toEqual([32, ["codex"]]);
	});

	it("the preview masks every argument and the URL path, and never returns sign-in, query or fragment", async () => {
		const sources = await service.sharedSources();
		expect(sources.filter((s) => s.agent === "claude-code").map((s) => [s.key, s.transport])).toEqual([
			["docs", "stdio"],
			["web", "http"],
		]);
		const sourceEnv = { ...process.env, HOME: home, USERPROFILE: home } as Record<string, string>;
		const web = await service.preview({ agent: "claude-code", path: claudeJson, key: "web" });
		expect(web).toEqual({
			source: { agent: "claude-code", path: claudeJson, key: "web" },
			transport: "http",
			command: null,
			args: [],
			origin: "https://mcp.example",
			hasPath: true,
			removed: ["sign-in", "query", "fragment"],
			env: [],
			headers: [],
			revision: mcpSourceHash(readMcpSource("claude-code", sourceEnv, claudeJson, "web")),
		});
		const docs = await service.preview({ agent: "claude-code", path: claudeJson, key: "docs" });
		expect([docs.args, docs.env, JSON.stringify(docs).includes(ARG)]).toEqual([[null, null], ["TOKEN"], false]);
		expect(await service.reveal({ source: docs.source, row: 1, revision: docs.revision })).toEqual({ value: ARG });
		expect(await service.reveal({ source: web.source, row: "path", revision: web.revision })).toEqual({ value: `/v1/${ARG}` });
	});

	it("refuses a reveal or an approval of a source that changed since its preview", async () => {
		const docs = await service.preview({ agent: "claude-code", path: claudeJson, key: "docs" });
		await expect(service.reveal({ source: docs.source, row: 1, revision: "older" })).rejects.toEqual(
			refused("The source changed since it was shown; open it again"),
		);
		await expect(
			service.approveSharedServer({
				name: "docs",
				def: docsDef,
				values: {},
				recipients: [],
				from: { ...docs.source, revision: "older" },
			}),
		).rejects.toEqual(refused("The source changed since it was shown; open it again"));
		expect(await names()).toEqual([]);
	});

	it("What loads uses the run's delivery: deepagents gets a server with values and a value-free one, both in its run file and neither value in it", async () => {
		await approveDocs(["deepagents"]);
		await approveWeb("/v1", {}, ["deepagents"], []);
		const view = await service.loadout({ id: "deepagents" });
		const cwd = join(env.root, "deepagents-ws");
		const runDir = join(env.root, "deepagents-run");
		mkdirSync(cwd, { recursive: true });
		const shared = await service.forRun("deepagents", cwd);
		const run = prepareRunEnv({ harness: "deepagents", cwd, runDir, shared, hostEnv: {} });
		const text = readFileSync(join(runDir, "config", GATEWAY_RUN_FILE), "utf8");
		expect([
			view.items.filter((i) => i.scope === "prismalens").map((i) => [i.name, i.state, i.note ?? null]),
			shared?.servers,
			Object.keys((JSON.parse(text) as { mcpServers: object }).mcpServers),
			text.includes(SECRET),
			run.args,
		]).toEqual([
			[
				["pl-docs", "loads", null],
				["pl-web", "loads", null],
			],
			[],
			["pl-docs", "pl-web"],
			false,
			["--acp", "--mcp-config", join(runDir, "config", GATEWAY_RUN_FILE)],
		]);
		// deepagents-code 0.2.1 expands each `${VAR}` once, from the env the child gets.
		const resolved = JSON.parse(text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k: string) => run.env[k] ?? "<unset>")) as {
			mcpServers: Record<string, Record<string, unknown>>;
		};
		expect([resolved.mcpServers["pl-docs"], resolved.mcpServers["pl-web"]]).toEqual([
			{ command, args: ["--root", ARG, SECRET], env: { TOKEN: SECRET } },
			{ type: "http", url: "https://mcp.example/v1", headers: {} },
		]);
	});
});

describe("What loads merges only a matching session's report (#1180 §3.1)", () => {
	const project = join(env.root, "project");
	let repositoryId = "";
	let n = 0;
	const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

	async function reportOn(
		fingerprint: string,
		profile: "own" | "clean",
		createdAt = at(0),
		items: Record<string, unknown>[] = [
			{ kind: "mcp", name: "db", scope: "repo", path: join(project, ".mcp.json"), disk: true, reported: null, state: "failed" },
			{ kind: "plugin", name: "lint@m", scope: "plugin", path: null, disk: true, reported: null, state: "loads" },
			{ kind: "mcp", name: "docs", scope: "global", path: null, disk: true, reported: null, state: "loads" },
		],
	) {
		const inv = await prisma.investigation.create({
			data: { harness: "claude-code", repositoryId },
		});
		await prisma.investigationEvent.create({
			data: {
				investigationId: inv.id,
				seq: n++,
				branchId: "main",
				createdAt,
				event: JSON.stringify({ kind: "agent_loadout", profile, cwd: project, fingerprint, items }),
			},
		});
		return inv.id;
	}
	const ownFingerprint = async () => (await service.forRun("claude-code", project)).fingerprint;

	beforeAll(async () => {
		mkdirSync(project, { recursive: true });
		repositoryId = (await prisma.repository.create({ data: { fullName: "local/project", url: project } })).id;
	});
	beforeEach(() => {
		writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db" } } }));
	});

	it("merges the newest own-profile report whose fingerprint matches; a clean-profile view ignores it", async () => {
		expect((await service.loadout({ id: "claude-code", repositoryId })).report).toBeNull();
		const fp = await ownFingerprint();
		await reportOn(fp, "own", at(1));
		const newer = await reportOn(fp, "own", at(2));
		const merged = await service.loadout({ id: "claude-code", repositoryId });
		expect(merged.report?.threadId).toBe(newer);
		expect(merged.items.find((i) => i.name === "db")).toMatchObject({ disk: true, state: "failed", scope: "repo" });
		expect(merged.items.find((i) => i.name === "lint@m")).toMatchObject({ disk: false, state: "loads" });
		// Claude's init gives no path: its row merges into the disk row by kind, name and scope.
		expect(merged.items.filter((i) => i.name === "docs").map((i) => [i.disk, i.state, i.path])).toEqual([
			[true, "loads", claudeJson],
		]);
		const clean = await service.loadout({ id: "claude-code", repositoryId, profile: "clean" });
		expect([clean.report, clean.staleReport, clean.items.some((i) => i.name === "lint@m")]).toEqual([null, null, false]);
	});

	it("a clean-profile view leaves out what Codex said its own config loads; the own view keeps it", async () => {
		codexSaid.items = [
			{ kind: "hook", name: "SessionStart", scope: "global", path: join(env.root, "home", ".codex", "hooks.json"), disk: true, reported: "2026-11-27T00:00:00.000Z", state: "loads" },
		];
		const said = async (profile: "own" | "clean") =>
			(await service.loadout({ id: "codex", repositoryId, profile })).items.filter((i) => i.kind === "hook").map((i) => [i.name, i.state]);
		try {
			expect([await said("own"), await said("clean")]).toEqual([[["SessionStart", "loads"]], []]);
		} finally {
			codexSaid.items = null;
		}
	});

	it("a config edit after the last run drops the merge and points at that run as a different setup", async () => {
		const thread = await reportOn(await ownFingerprint(), "own");
		writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db2" } } }));
		const after = await service.loadout({ id: "claude-code", repositoryId });
		expect([after.report, after.staleReport?.threadId]).toEqual([null, thread]);
		expect(after.items.find((i) => i.name === "db")).toMatchObject({ state: "in-project", reported: null });
	});

	it("removing the agent from a shared server's recipients makes its report a different setup", async () => {
		await approveWeb("/v1", {}, ["claude-code"], []);
		const thread = await reportOn(await ownFingerprint(), "own", at(1), [
			{ kind: "mcp", name: "pl-web", scope: "prismalens", path: null, disk: false, reported: null, state: "loads" },
		]);
		expect((await service.loadout({ id: "claude-code", repositoryId })).report?.threadId).toBe(thread);
		await approveWeb("/v1", {}, [], []);
		const after = await service.loadout({ id: "claude-code", repositoryId });
		expect([after.report, after.staleReport?.threadId, after.items.find((i) => i.name === "pl-web")?.state]).toEqual([
			null,
			thread,
			"not-sent",
		]);
	});

	it("finds a matching report behind 20 newer reports of other setups", async () => {
		const match = await reportOn(await ownFingerprint(), "own", at(1));
		for (let i = 0; i < 20; i++) await reportOn(`other-${i}`, "own", at(2 + i));
		expect((await service.loadout({ id: "claude-code", repositoryId })).report?.threadId).toBe(match);
	});

	it("a pathless project-scope report marks the project row, not a global row of the same name", async () => {
		writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { docs: { command: "d" } } }));
		await reportOn(await ownFingerprint(), "own", at(1), [
			{ kind: "mcp", name: "docs", scope: "repo", path: null, disk: true, reported: null, state: "loads" },
		]);
		const view = await service.loadout({ id: "claude-code", repositoryId });
		expect(view.items.filter((i) => i.name === "docs").map((i) => [i.scope, i.state])).toEqual([
			["global", "found"],
			["repo", "loads"],
		]);
	});
});
