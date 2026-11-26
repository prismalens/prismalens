// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
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
				"pl-web": { type: "http", url: "https://mcp.example/v1?key=${PL_SV_WEB_1}", headers: { Authorization: "${PL_SV_WEB_2}" } },
			},
			env: { PL_SV_DOCS_1: "db-secret-arg", PL_SV_DOCS_2: VALUE, PL_SV_WEB_1: "q-secret", PL_SV_WEB_2: "Bearer h-secret" },
		});
		const file = JSON.stringify(out.runFile?.servers);
		expect([VALUE, "db-secret-arg", "q-secret", "h-secret"].filter((v) => file.includes(v) || file.includes(JSON.stringify(v).slice(1, -1)))).toEqual([]);
		expect(out.hidden).toEqual(expect.arrayContaining([VALUE, "db-secret-arg", "q-secret", "Bearer h-secret"]));
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

	it("resolves a relative PATH entry to an absolute command path", () => {
		const bin = mkdtempSync(join(dir, "bin-"));
		writeFileSync(join(bin, "docs"), "x");
		const rel = relative(process.cwd(), bin);
		expect(resolveCommand("docs", { PATH: rel }, "linux")).toBe(join(bin, "docs"));
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
