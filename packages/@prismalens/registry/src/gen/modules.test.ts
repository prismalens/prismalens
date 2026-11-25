// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generate } from "./index.ts";
import { scan, scanModules } from "./modules.ts";

const KIND_TS = new URL("../kind.ts", import.meta.url).href;

// A module kind: plain TypeScript the generator imports, with a guard that reads live values.
const KIND = `import { defineKind, guard } from ${JSON.stringify(KIND_TS)};
const schema = { "~standard": { validate: (v) => (typeof v.name === "string" ? {} : { issues: [{ message: "needs a name" }] }) } };
const named = guard("named", "Give it a name.", (c) => Array.from(c.live("gadget").values()).filter((g) => g.name === "bad").map((g) => \`gadget "\${g.id}" is named bad\`));
export const gadget = defineKind({
	name: "gadget",
	suffix: ".gadgets.ts",
	about: "A test gadget.",
	keywords: ["gadget"],
	schema,
	refs: {},
	guards: [named],
	define: (d) => ({ ...d, kind: "gadget" }),
	scaffold: { dir: "src", imports: [], entry: "" },
});
`;

let root = "";
const put = (f: string, text: string) => {
	mkdirSync(dirname(join(root, f)), { recursive: true });
	writeFileSync(join(root, f), text);
};
const cfg = (extra: object = {}) => ({
	root,
	collect: "module" as const,
	src: "src",
	kinds: "src/kinds",
	out: "src",
	...extra,
});

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "registry-modules-"));
	put("src/kinds/gadget.ts", KIND);
	put(
		"src/a/a.gadgets.ts",
		`export const one = { kind: "gadget", id: "gadget.one", name: "One", stored: [{ column: "T.c", value: "one" }], run: () => 1 };\n`,
	);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("scan", () => {
	it("imports the kinds and entries and keeps only the entries' literal fields", async () => {
		const r = await scan(root, ["src/kinds/gadget.ts"], ["src/a/a.gadgets.ts"]);
		expect(r.problems).toEqual([]);
		expect(Object.keys(r.kinds)).toEqual(["gadget"]);
		expect(r.entries.gadget).toEqual([
			{
				id: "gadget.one",
				file: "src/a/a.gadgets.ts",
				export: "one",
				fields: { kind: "gadget", id: "gadget.one", name: "One", stored: [{ column: "T.c", value: "one" }] },
			},
		]);
	});

	it("runs the kind's guards and schema over the live entries", async () => {
		put("src/a/b.gadgets.ts", `export const bad = { kind: "gadget", id: "gadget.bad", name: "bad" };\nexport const nameless = { kind: "gadget", id: "gadget.nameless" };\n`);
		const r = await scan(root, ["src/kinds/gadget.ts"], ["src/a/a.gadgets.ts", "src/a/b.gadgets.ts"]);
		expect(r.problems).toEqual([
			'[gadget/schema] gadget "gadget.nameless": needs a name. Fix: Make the definition match its kind\'s schema.',
			'[gadget/named] gadget "gadget.bad" is named bad. Fix: Give it a name.',
		]);
	});
});

describe("scanModules", () => {
	it("reports an entry file that cannot be imported, naming the host", () => {
		put("src/a/broken.gadgets.ts", "export const x = ;\n");
		const r = scanModules(root, ["src/kinds/gadget.ts"], ["src/a/broken.gadgets.ts"]);
		expect(r.problems).toHaveLength(1);
		expect(r.problems[0]).toMatch(new RegExp(`^registry: importing the module host at ${root.replace(/\\/g, "\\\\")} failed: `));
	});
});

describe("generate on a module host", () => {
	it("writes a static barrel of the entry files and the manifest", () => {
		const { problems, manifest } = generate(cfg());
		expect(problems).toEqual([]);
		expect(manifest.entries.gadget?.map((e) => e.id)).toEqual(["gadget.one"]);
		const barrel = readFileSync(join(root, "src/registry.gen.ts"), "utf8");
		expect(barrel).toContain('import * as m0 from "./a/a.gadgets.ts";');
		expect(barrel).toContain('\t"src/a/a.gadgets.ts": m0,');
		expect(barrel).toContain('export type GadgetId =\n\t| "gadget.one";');
	});

	it("fails on a stored claim with no ledger row, and --write-ledger appends it", () => {
		const ledger = { file: "stored-ids.tsv", kind: "gadget", field: "stored" };
		expect(generate(cfg({ ledger })).problems).toEqual([
			"[gadget/stored-id] gadget.one claims T.c=one, which is not in the ledger yet. Fix: a new claim gets its row from `pnpm registry gen --write-ledger`; a shipped value keeps its owner (rename through aliases).",
		]);
		expect(existsSync(join(root, "stored-ids.tsv"))).toBe(false);
		expect(generate(cfg({ ledger }), { writeLedger: true }).problems).toEqual([]);
		expect(readFileSync(join(root, "stored-ids.tsv"), "utf8")).toMatch(/\nT\.c\tone\tgadget\.one\n$/);
	});
});
