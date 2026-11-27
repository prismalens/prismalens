// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { SharedMcpServerStored } from "@prismalens/contracts/schemas";
import { afterAll, describe, expect, it } from "vitest";
import { gatewayOffer, type GatewayEntry } from "./gateway.js";
import {
	bindFiles,
	deliverShared,
	resolveCommand,
	ShareRefused,
	sharedServerHash,
} from "./shared-set.js";

const dir = mkdtempSync(join(tmpdir(), "pl-shared-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const VALUE = 'tok-"q"\\b\nend';

async function stdio(
	over: Partial<SharedMcpServerStored> = {},
): Promise<SharedMcpServerStored> {
	const command = join(dir, `server-${Math.random().toString(36).slice(2)}`);
	writeFileSync(command, "marker-A");
	const bound = await bindFiles(
		{ type: "stdio", command, args: ["--db", { value: "DB_ARG" }], env: ["TOKEN"] },
		{},
	);
	const hash = sharedServerHash(bound.def, bound.files);
	return {
		name: "docs",
		...bound,
		values: { TOKEN: VALUE, DB_ARG: "db-secret-arg" },
		hash,
		valuesFor: hash,
		recipients: ["claude-code", "codex"],
		from: null,
		...over,
	};
}

const http = (over: Partial<SharedMcpServerStored> = {}): SharedMcpServerStored => {
	const def = {
		type: "http" as const,
		url: "https://mcp.example/v1",
		query: ["key"],
		headers: ["Authorization"],
	};
	const hash = sharedServerHash(def, []);
	return {
		name: "web",
		def,
		files: [],
		values: { key: "q-secret", Authorization: "Bearer h-secret" },
		hash,
		valuesFor: hash,
		recipients: ["claude-code"],
		from: null,
		...over,
	};
};

describe("deliverShared (#1180 §3.3)", () => {
	it("sends a recipient's bound stdio server as pl-<name>, values from storage, and lists every value to hide", async () => {
		const s = await stdio();
		const out = await deliverShared([s], "codex", { http: false, ownNames: [] });
		expect(out.servers).toEqual([
			{
				name: "pl-docs",
				command: s.def.type === "stdio" ? s.def.command : "",
				args: ["--db", "db-secret-arg"],
				env: [{ name: "TOKEN", value: VALUE }],
			},
		]);
		expect(out.items.map((i) => [i.name, i.state, i.note ?? null])).toEqual([["pl-docs", "loads", null]]);
		expect(out.hidden.sort()).toEqual(["db-secret-arg", VALUE].sort());
	});

	it("an HTTP server carries its query and header values, and is not sent without HTTP", async () => {
		const withHttp = await deliverShared([http()], "claude-code", { http: true, ownNames: [] });
		expect(withHttp.servers).toEqual([
			{
				type: "http",
				name: "pl-web",
				url: "https://mcp.example/v1?key=q-secret",
				headers: [{ name: "Authorization", value: "Bearer h-secret" }],
			},
		]);
		const without = await deliverShared([http()], "claude-code", { http: false, ownNames: [] });
		expect([without.servers, without.items[0]?.note]).toEqual([[], "Not sent: no HTTP"]);
	});

	it("says why each server is not sent: not a recipient, values entered for another definition, name taken", async () => {
		const s = await stdio();
		const notes = async (stored: SharedMcpServerStored, agent: string, o: { ownNames?: string[]; runFile?: boolean } = {}) =>
			(await deliverShared([stored], agent, { http: true, ownNames: o.ownNames ?? [], ...(o.runFile ? { runFile: true } : {}) })).items[0]?.note;
		expect(await notes(s, "gemini")).toBe("Not a recipient");
		expect(await notes({ ...s, valuesFor: "an-older-hash" }, "codex")).toBe("Not sent: needs values");
		expect(await notes({ ...s, values: { TOKEN: VALUE } }, "codex")).toBe("Not sent: needs values");
		expect(await notes(s, "codex", { ownNames: ["pl-docs"] })).toBe("Not sent: name taken");
	});

	it("gives an agent with a run file its servers as ${PL_SV_...} references, with each value only in the env they read", async () => {
		const s = await stdio({ recipients: ["deepagents"] });
		const w = http({ recipients: ["deepagents"] });
		const out = await deliverShared([s, w], "deepagents", { http: true, ownNames: [], runFile: true });
		const command = s.def.type === "stdio" ? s.def.command : "";
		expect([out.servers, out.items.map((i) => i.state)]).toEqual([[], ["loads", "loads"]]);
		expect(out.runFile).toEqual({
			servers: {
				"pl-docs": { command, args: ["--db", "${PL_SV_DOCS_1}"], env: { TOKEN: "${PL_SV_DOCS_2}" } },
				"pl-web": { type: "http", url: "${PL_SV_WEB_1}", headers: { Authorization: "${PL_SV_WEB_2}" } },
			},
			env: {
				PL_SV_DOCS_1: "db-secret-arg",
				PL_SV_DOCS_2: VALUE,
				PL_SV_WEB_1: "https://mcp.example/v1?key=q-secret",
				PL_SV_WEB_2: "Bearer h-secret",
			},
		});
		const file = JSON.stringify(out.runFile?.servers);
		expect([VALUE, "db-secret-arg", "q-secret", "h-secret"].filter((v) => file.includes(v) || file.includes(JSON.stringify(v).slice(1, -1)))).toEqual([]);
		expect(out.hidden).toEqual(expect.arrayContaining([VALUE, "db-secret-arg", "q-secret", "Bearer h-secret"]));
	});

	it("a run file's servers expand, as deepagents expands them, to exactly what ACP sends, whatever a value or a literal holds", async () => {
		// deepagents-code 0.2.1 `_interpolate_env`: one pass of `${VAR}`, so a value's own `${...}` stays as it is.
		const expand = (text: string, env: Record<string, string>) =>
			text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k: string) => env[k] ?? "");
		const key = "a&b+c#d=e%f g${PL_SV_WEB_2}";
		const w = http({
			recipients: ["deepagents", "claude-code"],
			def: { type: "http", url: "https://mcp.example/v1?fixed=${HOME}", query: ["key"], headers: ["Authorization"] },
			values: { key, Authorization: "Bearer h-secret" },
		});
		const s = await stdio({ recipients: ["deepagents", "claude-code"] });
		const literal = { ...s, def: { ...s.def, args: ["--root=${HOME}", { value: "DB_ARG" }] } } as SharedMcpServerStored;
		const viaFile = await deliverShared([w, literal], "deepagents", { http: true, ownNames: [], runFile: true });
		const viaAcp = await deliverShared([w, literal], "claude-code", { http: true, ownNames: [] });
		const env = viaFile.runFile?.env ?? {};
		const web = viaFile.runFile?.servers["pl-web"] as { url: string };
		const docs = viaFile.runFile?.servers["pl-docs"] as { args: string[] };
		const acpWeb = viaAcp.servers.find((x) => x.name === "pl-web") as { url: string };
		const acpDocs = viaAcp.servers.find((x) => x.name === "pl-docs") as { args: string[] };
		expect([
			expand(web.url, env),
			new URL(expand(web.url, env)).searchParams.get("key"),
			docs.args.map((a) => expand(a, env)),
			viaFile.hidden.includes("a%26b%2Bc%23d%3De%25f+g%24%7BPL_SV_WEB_2%7D"),
		]).toEqual([acpWeb.url, key, acpDocs.args, true]);
		expect(acpWeb.url).toBe("https://mcp.example/v1?fixed=%24%7BHOME%7D&key=a%26b%2Bc%23d%3De%25f+g%24%7BPL_SV_WEB_2%7D");
		expect(acpDocs.args).toEqual(["--root=${HOME}", "db-secret-arg"]);
	});

	it("a deleted command, or one replaced by a same-size file with its mtime restored, is not sent and shows Changed", async () => {
		const s = await stdio();
		const command = s.def.type === "stdio" ? s.def.command : "";
		const { mtime, atime } = statSync(command);
		writeFileSync(command, "marker-B");
		utimesSync(command, atime, mtime);
		const replaced = await deliverShared([s], "codex", { http: false, ownNames: [] });
		expect([replaced.servers, replaced.items[0]?.note, replaced.hidden]).toEqual([[], "Changed", []]);
		rmSync(command);
		const deleted = await deliverShared([s], "codex", { http: false, ownNames: [] });
		expect(deleted.items[0]?.note).toBe("Changed");
	});

	it("refuses a relative path argument at share", async () => {
		await expect(
			bindFiles({ type: "stdio", command: join(dir, "x"), args: ["./config.json"], env: [] }, {}),
		).rejects.toEqual(new ShareRefused("relative-path", "Uses a relative path"));
	});

	it.each([["scripts/server.js"], ["server.js"], ["--config=conf/x.toml"], ["~/x.json"], ["..\\up.json"]])(
		"refuses %s, an argument that names a file relative to the folder it starts in",
		async (arg) => {
			const command = join(dir, "rel-cmd");
			writeFileSync(command, "x");
			await expect(bindFiles({ type: "stdio", command, args: [arg], env: [] }, {})).rejects.toEqual(
				new ShareRefused("relative-path", "Uses a relative path"),
			);
		},
	);

	it("keeps flags, words and URLs, and binds an absolute file named after a flag's =", async () => {
		const command = join(dir, "abs-cmd");
		const conf = join(dir, "conf.toml");
		writeFileSync(command, "x");
		writeFileSync(conf, "y");
		const { files } = await bindFiles(
			{ type: "stdio", command, args: ["--stdio", "serve", "https://h/x", `--config=${conf}`], env: [] },
			{},
		);
		expect(files.map((f) => f.path)).toEqual([command, conf]);
	});

	it("refuses a command that vanished or turned to a folder before its hash, or cannot be read, and binds a missing argument file as optional", async () => {
		const command = join(dir, "hash-cmd");
		writeFileSync(command, "x");
		const conf = join(dir, "missing-conf.toml");
		const def = { type: "stdio" as const, command, args: [`--config=${conf}`], env: [] };
		const refused = (hash: (p: string) => Promise<string | null>) =>
			bindFiles(def, {}, hash).then(
				() => "approved",
				(e: unknown) => e,
			);
		const folder = mkdtempSync(join(dir, "cmd-dir-"));
		expect([
			await refused(async () => null),
			await refused(async () => {
				throw Object.assign(new Error("EACCES"), { code: "EACCES" });
			}),
			await refused(async () => {
				throw new ShareRefused("too-large", "Too large to check");
			}),
			await bindFiles({ ...def, command: folder }, {}).then(() => "approved", (e: unknown) => e),
			await bindFiles({ ...def, command: "bin/hash-cmd" }, {}).then(() => "approved", (e: unknown) => e),
			(await bindFiles(def, {})).files.map((f) => f.path),
		]).toEqual([
			new ShareRefused("not-found", "Command not found"),
			new ShareRefused("unreadable", "Command could not be read"),
			new ShareRefused("too-large", "Too large to check"),
			new ShareRefused("not-found", "Command not found"),
			new ShareRefused("relative-path", "Uses a relative path"),
			[command],
		]);
	});

	it("resolves a relative PATH entry to an absolute command path", () => {
		const bin = mkdtempSync(join(dir, "bin-"));
		writeFileSync(join(bin, "docs"), "x");
		const rel = relative(process.cwd(), bin);
		expect(resolveCommand("docs", { PATH: rel }, "linux")).toBe(join(bin, "docs"));
	});
});

describe("a node script relative to the session's folder (#1180 §3.3)", () => {
	const NOTE = "Needs an absolute script path";
	const ws = mkdtempSync(join(dir, "ws-"));
	const outside = mkdtempSync(join(dir, "out-"));
	// Each name below is written so Node resolves it on every platform: on Windows `\` is a
	// separator, elsewhere part of the file's name.
	mkdirSync(join(ws, "srv"));
	mkdirSync(join(ws, "%2e%2e"));
	mkdirSync(join(dir, "x"), { recursive: true });
	for (const f of ["server.js", ".\\server.js", "srv/index.js", "srv\\index.js", "%2e%2e/server.js"])
		writeFileSync(join(ws, f), "x");
	writeFileSync(join(dir, "x", "server.js"), "x");
	writeFileSync(join(outside, "index.js"), "x");
	symlinkSync(outside, join(ws, "out"), "junction");
	const pkg = mkdtempSync(join(dir, "ws-"));
	mkdirSync(join(pkg, "server"));
	writeFileSync(join(pkg, "server", "index.js"), "x");
	type Arg = string | { value: string };
	/** A bound server whose command is a file named `name`, as approval stores it. */
	const server = async (name: string, args: Arg[], values: Record<string, string>) => {
		const bin = mkdtempSync(join(dir, "bin-"));
		writeFileSync(join(bin, name), "x");
		const bound = await bindFiles({ type: "stdio", command: join(bin, name), args, env: [] }, {});
		const hash = sharedServerHash(bound.def, bound.files);
		return { name: "s", ...bound, values, hash, valuesFor: hash, recipients: ["claude-code"], from: null };
	};
	const deliver = async (name: string, args: Arg[], values: Record<string, string> = {}, cwd = ws) =>
		deliverShared([await server(name, args, values)], "claude-code", { http: true, ownNames: [], cwd });
	const sent = async (name: string, args: Arg[], values: Record<string, string> = {}, cwd = ws) => {
		const d = await deliver(name, args, values, cwd);
		return [d.servers.length, d.items[0]?.note ?? null];
	};
	const script = (value: string, cwd = ws, before: string[] = [], name = "node") =>
		sent(name, [...before, { value: "SCRIPT" }], { SCRIPT: value }, cwd);

	it("is not sent, and says it needs an absolute script path, for `node server` with server.js or with server/index.js", async () => {
		expect([await sent("node", ["server"]), await sent("node", ["server"], {}, pkg)]).toEqual([
			[0, NOTE],
			[0, NOTE],
		]);
	});

	it("checks the argv after values are put in: a value naming a relative script in any spelling Node resolves is not sent", async () => {
		const values = ["server", "./server", ".\\server", "srv/", "srv\\index", "../x/server", "%2e%2e/server", "out"];
		const outcomes = [];
		for (const v of values) outcomes.push(await script(v));
		outcomes.push(await script("server", pkg));
		expect(outcomes).toEqual([...values, "server/index.js"].map(() => [0, NOTE]));
	});

	it("finds the entry script after node's own options, after --, and when node is node.exe", async () => {
		const before = [["--inspect"], ["-r", "x"], ["--require", "server"], ["--import", "x"], ["--loader", "x"], ["--require=x"], ["--"], [], []];
		const names = ["node", "node", "node", "node", "node", "node", "node", "node.exe", "NODE"];
		const outcomes = [];
		for (const [i, b] of before.entries()) outcomes.push(await script("server", ws, b, names[i]));
		expect(outcomes).toEqual(before.map(() => [0, NOTE]));
	});

	it("sends a server whose relative names are the script's own arguments, or that runs no script file", async () => {
		writeFileSync(join(ws, "serve.js"), "x");
		const abs = join(ws, "server.js");
		const argvs = [
			[abs, "serve"],
			[abs, "--flag", "serve"],
			["--require", "server", abs, "serve"],
			["-e", "server"],
			["-p", "1"],
			["-pe", "1"],
			["--eval=server"],
			["--print", "1"],
			["-"],
			["--run", "server"],
			["--", abs, "server"],
		];
		const outcomes = [];
		for (const argv of argvs) outcomes.push(await sent("node", argv));
		expect(outcomes).toEqual(argvs.map(() => [1, null]));
	});

	it("puts a value into neither the note, the row nor the servers when it holds one back", async () => {
		const secret = "srv-7f3a9c";
		writeFileSync(join(ws, `${secret}.js`), "x");
		const d = await deliver("node", [{ value: "SCRIPT" }], { SCRIPT: secret });
		expect([d.items[0]?.note, d.servers, d.hidden, JSON.stringify(d).includes(secret)]).toEqual([NOTE, [], [], false]);
	});

	it("sends `npx some-pkg serve`, `node --run build` and a node script given by its full path", async () => {
		expect([
			await sent("npx", ["some-pkg", "serve"]),
			await sent("node", ["--run", "build"]),
			await sent("node", [join(ws, "server.js")]),
			await script(join(ws, "server.js")),
		]).toEqual([
			[1, null],
			[1, null],
			[1, null],
			[1, null],
		]);
	});
});

describe("gatewayOffer.pick with the PrismaLens set (#1180 §3.3)", () => {
	const entry = { url: "http://127.0.0.1:1/mcp", token: "t", serverName: "prismalens", connected: () => false } as unknown as GatewayEntry;
	const stdioServer = { name: "pl-docs", command: "/bin/docs", args: [], env: [] };
	const httpServer = { type: "http" as const, name: "pl-web", url: "https://w", headers: [] };

	it("sends the gateway first, then each shared server; without HTTP only stdio ones", () => {
		expect(gatewayOffer(entry).pick({ http: true }, [stdioServer, httpServer]).map((s) => s.name)).toEqual([
			"prismalens",
			"pl-docs",
			"pl-web",
		]);
		expect(gatewayOffer(entry).pick({ http: false }, [stdioServer, httpServer]).map((s) => s.name)).toEqual(["pl-docs"]);
	});
});
