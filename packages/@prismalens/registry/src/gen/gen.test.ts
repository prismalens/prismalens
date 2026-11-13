// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { scopeOf } from "./extract.ts";
import {
	generate,
	type KindSource,
	literal,
	readEntries,
	readGallery,
	readKinds,
	readUses,
} from "./index.ts";

const KIND = `import { defineKind } from "@prismalens/registry";
export const widget = defineKind({
	name: "widget",
	suffix: ".widgets.ts",
	about: "A test widget.",
	schema,
	refs: { "menu.items": "action" },
	guards: [labelled, ns.reachable],
	define: defineWidget,
	aliases: ["defineWidget"],
	uses: { components: ["Widget"], attribute: "data-widget" },
});`;

const widget: KindSource = {
	name: "widget",
	file: "k.ts",
	suffix: ".widgets.ts",
	about: "",
	refs: {},
	guards: ["labelled"],
	aliases: ["defineWidget"],
	keywords: [],
	uses: { components: ["Widget"], attribute: "data-widget" },
};

const lastExpression = (src: string) => {
	const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
	const last = sf.statements.at(-1) as ts.ExpressionStatement;
	return { sf, e: last.expression };
};

describe("the extractor", () => {
	it("reads a kind's literal fields and its guard names", () => {
		const problems: string[] = [];
		expect(readKinds("k.ts", KIND, problems)).toEqual([
			{
				name: "widget",
				file: "k.ts",
				suffix: ".widgets.ts",
				about: "A test widget.",
				refs: { "menu.items": "action" },
				aliases: ["defineWidget"],
				keywords: [],
				guards: ["labelled", "reachable"],
				uses: { components: ["Widget"], attribute: "data-widget" },
			},
		]);
		expect(problems).toEqual([]);
	});

	it("refuses a kind whose name is computed", () => {
		const problems: string[] = [];
		const src = "defineKind({ name: N, suffix: '.x.ts', about: 'a' });";
		expect(readKinds("k.ts", src, problems)).toEqual([]);
		expect(problems).toEqual([
			"k.ts:1: a kind's name, suffix and about must be string literals",
		]);
	});

	it("resolves same-file consts and spreads, and drops computed parts", () => {
		const { sf, e } = lastExpression(
			`const A = ["a", "b"] as const; const O = { x: 1 };
({ list: [...A, "c"], o: { ...O, y: -2, z: null, t: true }, f: () => 1, bad: [g()], ref: A });`,
		);
		expect(literal(e, scopeOf(sf))).toEqual({
			list: ["a", "b", "c"],
			o: { x: 1, y: -2, z: null, t: true },
			ref: ["a", "b"],
		});
	});

	it("reads exported entries by define.<kind> and by alias, with their literal fields", () => {
		const problems: string[] = [];
		const src = `const ITEMS = ["a.one"] as const;
export const one = define.widget({ id: "w.one", label: "One", menu: { items: ITEMS }, run: () => {} });
export const two = defineWidget({ id: \`w.two\`, label: "Two" });`;
		expect(readEntries("a.widgets.ts", src, [widget], problems)).toEqual([
			{
				kind: "widget",
				entry: {
					id: "w.one",
					file: "a.widgets.ts",
					export: "one",
					fields: { id: "w.one", label: "One", menu: { items: ["a.one"] } },
				},
			},
			{
				kind: "widget",
				entry: {
					id: "w.two",
					file: "a.widgets.ts",
					export: "two",
					fields: { id: "w.two", label: "Two" },
				},
			},
		]);
		expect(problems).toEqual([]);
	});

	it("names every definition the collector could not read", () => {
		const problems: string[] = [];
		const src = `const ID = "w.x";
export const a = define.widget({ id: ID });
const b = define.widget({ id: "w.b" });
export const c = define.gadget({ id: "g.c" });
export const d = [define.widget({ id: "w.d" })];`;
		expect(readEntries("a.widgets.ts", src, [widget], problems)).toEqual([]);
		expect(problems).toEqual([
			"a.widgets.ts:2: a widget's id must be a string literal",
			"a.widgets.ts:3: export b; the collector reads exports only",
			"a.widgets.ts:4: define.gadget names no registered kind",
			"a.widgets.ts:5: bind each definition to an exported const at the top of the file",
		]);
	});

	it("refuses a definition outside its kind's suffix", () => {
		const problems: string[] = [];
		const src = `export const a = define.widget({ id: "w.a" });`;
		readEntries("a.ts", src, [widget], problems);
		expect(problems).toEqual([
			"a.ts:1: a widget is defined only in a .widgets.ts file",
		]);
	});

	it("reads gallery ids from stages, data-kit-state and { id, title } sections", () => {
		const src = `export const S = [{ id: "sec-a", title: "A" }, { id: "no-title" }];
export const G = () => <><Stage id="stage-a" caption="x" /><div data-kit-state={"state-a"} /><Stage id={dynamic} /></>;`;
		expect(readGallery("g.tsx", src).sort()).toEqual([
			"sec-a",
			"stage-a",
			"state-a",
		]);
	});

	it("reads where a kind's ids render, by component and by attribute", () => {
		const src = `export const V = () => <><Widget id="w.one" /><div data-widget="w.two" /><Widget id={x} /><Other id="no" /></>;`;
		expect(readUses("v.tsx", src, [widget])).toEqual([
			{ kind: "widget", use: { id: "w.one", file: "v.tsx" } },
			{ kind: "widget", use: { id: "w.two", file: "v.tsx" } },
		]);
	});
});

describe("generate", () => {
	let root = "";
	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true });
	});
	const put = (f: string, text: string) => {
		mkdirSync(dirname(join(root, f)), { recursive: true });
		writeFileSync(join(root, f), text);
	};
	const cfg = () => ({
		root,
		src: "src",
		kinds: "src/registry/kinds",
		out: "src/registry",
		gallery: "src/design",
	});

	it("writes the id unions, ref types and glob, then reports nothing stale", () => {
		root = mkdtempSync(join(tmpdir(), "registry-gen-"));
		put(
			"src/registry/kinds/widget.ts",
			KIND.replace('"menu.items": "action"', '"menu.items": "widget"'),
		);
		put(
			"src/a/b.widgets.ts",
			`export const b = define.widget({ id: "w.b", label: "B" });\nexport const a = define.widget({ id: "w.a", label: "A" });`,
		);
		put("src/design/gallery.tsx", `export const G = () => <Stage id="g-one" />;`);
		put("src/a/view.tsx", `export const V = () => <Widget id="w.a" />;`);
		const first = generate(cfg(), false);
		expect(first.problems).toEqual([]);
		expect(first.manifest.gallery).toEqual(["g-one"]);
		expect(first.manifest.uses).toEqual({
			widget: [{ id: "w.a", file: "src/a/view.tsx" }],
		});
		expect(first.manifest.entries.widget?.map((e) => e.id)).toEqual([
			"w.a",
			"w.b",
		]);
		const types = readFileSync(join(root, "src/registry/registry.gen.ts"), "utf8");
		expect(types).toContain('export type WidgetId =\n\t| "w.a"\n\t| "w.b";');
		expect(types).toContain('\twidget: { "menu.items": WidgetId; };');
		expect(types).toContain('\t\t"../**/*.widgets.ts",');
		expect(generate(cfg(), true).stale).toEqual([]);
	});

	it("names both files stale in check mode after a new entry, and writes neither", () => {
		root = mkdtempSync(join(tmpdir(), "registry-gen-"));
		put("src/registry/kinds/widget.ts", KIND);
		put(
			"src/a/b.widgets.ts",
			`export const b = define.widget({ id: "w.b", label: "B" });`,
		);
		generate(cfg(), false);
		const manifestFile = join(root, "src/registry/registry.manifest.json");
		const before = readFileSync(manifestFile, "utf8");
		put(
			"src/a/c.widgets.ts",
			`export const c = define.widget({ id: "w.c", label: "C" });`,
		);
		const { stale } = generate(cfg(), true);
		expect(stale.map((f) => f.split("/").at(-1))).toEqual([
			"registry.gen.ts",
			"registry.manifest.json",
		]);
		expect(readFileSync(manifestFile, "utf8")).toBe(before);
	});
});
