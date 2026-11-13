// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { defineClosed } from "./closed.ts";
import { collect } from "./collect.ts";
import { formatProblems, runGuards } from "./guards.ts";
import {
	type Entry,
	defineKind,
	entry,
	guard,
	makeDefine,
	type Schema,
} from "./kind.ts";
import type { Manifest } from "./manifest.ts";

/** A schema that wants a string `label`, in the Standard Schema shape zod implements. */
const needsLabel: Schema = {
	"~standard": {
		validate: (v) =>
			typeof (v as { label?: unknown }).label === "string"
				? {}
				: { issues: [{ message: "label must be a string" }] },
	},
};
const noop = guard("noop", "nothing to fix", () => []);
const scaffold = { dir: "src", imports: [], entry: "" };
const thing = defineKind({
	name: "thing",
	suffix: ".things.ts",
	about: "a test kind",
	keywords: ["thing"],
	scaffold,
	schema: needsLabel,
	refs: { uses: "widget" },
	guards: [noop],
	define: (d: { id: string; label?: string; uses?: string[] }) =>
		entry("thing", d),
});
const widget = defineKind({
	name: "widget",
	suffix: ".widgets.ts",
	about: "another test kind",
	keywords: ["widget"],
	scaffold,
	schema: needsLabel,
	refs: {},
	guards: [noop],
	define: (d: { id: string; label: string }) => entry("widget", d),
});
const kinds = [thing, widget] as const;

const manifestOf = (
	entries: Record<string, { id: string; fields?: Record<string, never> }[]>,
): Manifest => ({
	version: 1,
	kinds: {
		thing: { file: "k/thing.ts", suffix: ".things.ts", about: "", refs: { uses: "widget" }, guards: ["noop"], aliases: [], keywords: [] },
		widget: { file: "k/widget.ts", suffix: ".widgets.ts", about: "", refs: {}, guards: ["noop"], aliases: [], keywords: [] },
	},
	entries: Object.fromEntries(
		Object.entries(entries).map(([k, list]) => [
			k,
			list.map((e) => ({ id: e.id, file: `a${k}`, export: e.id, fields: e.fields ?? { id: e.id } })),
		]),
	),
	gallery: [],
	uses: {},
});

describe("defineKind and makeDefine", () => {
	it("rejects a kind whose guard list is empty at runtime", () => {
		expect(() =>
			defineKind({ ...widget, guards: [] as unknown as [typeof noop] }),
		).toThrow('kind "widget" needs at least one guard');
	});

	it("builds define.<kind> from each kind, and an entry carries its kind's name", () => {
		const define = makeDefine(kinds);
		expect(define.widget({ id: "w.one", label: "One" })).toEqual({
			kind: "widget",
			id: "w.one",
			label: "One",
		});
	});

	it("rejects a kind listed twice", () => {
		expect(() => makeDefine([widget, widget])).toThrow(
			'kind "widget" is listed twice',
		);
	});
});

describe("collect", () => {
	it("files entries by kind and flags duplicates and entries in the wrong file", () => {
		const w = entry("widget", { id: "w.one", label: "One" });
		const c = collect(kinds, {
			"./a.widgets.ts": { w, also: w, notAnEntry: 3 },
			"./b.things.ts": { stray: entry("widget", { id: "w.two", label: "Two" }) },
			"./c.things.ts": { odd: entry("gadget", { id: "g.one" }) },
		});
		expect(Array.from(c.of("widget").keys())).toEqual(["w.one"]);
		expect(c.of("gadget").size).toBe(0);
		expect(c.fileOf("widget", "w.one")).toBe("./a.widgets.ts");
		expect(c.dupes).toEqual(["widget:w.one (./a.widgets.ts)"]);
		expect(c.strays).toEqual([
			"widget:w.two (./b.things.ts)",
			"gadget:g.one (./c.things.ts)",
		]);
	});
});

describe("defineClosed", () => {
	it("returns each member's view", () => {
		const tone = defineClosed("tone", ["ok", "bad"], { ok: "green", bad: "red" });
		expect(tone.get("bad")).toBe("red");
		expect(tone.members).toEqual(["ok", "bad"]);
	});

	it("reads the members of a zod-style enum's options", () => {
		const tone = defineClosed("tone", { options: ["ok"] as const }, { ok: 1 });
		expect(tone.members).toEqual(["ok"]);
	});

	it("throws on a view for a non-member, naming the fix", () => {
		expect(() =>
			defineClosed("tone", ["ok"], { ok: 1, gone: 2 } as Record<"ok", number>),
		).toThrow(
			'closed set "tone" has views for non-members: gone. Remove them or add them to its union.',
		);
	});

	it("throws on a member with no view, naming the fix", () => {
		expect(() =>
			defineClosed("tone", ["ok", "bad"], { ok: 1 } as Record<"ok" | "bad", number>),
		).toThrow('closed set "tone" has no view for: bad. Add one to its record.');
	});
});

describe("runGuards", () => {
	const live = (mods: Record<string, Record<string, Entry>>) => collect(kinds, mods);

	it("passes a registry that holds together", () => {
		const m = manifestOf({
			thing: [{ id: "t.one", fields: { uses: ["w.one"] } as never }],
			widget: [{ id: "w.one" }],
		});
		const c = live({
			"a.things.ts": { t: entry("thing", { id: "t.one", label: "T", uses: ["w.one"] }) },
			"a.widgets.ts": { w: entry("widget", { id: "w.one", label: "W" }) },
		});
		expect(runGuards(kinds, m, c)).toEqual([]);
	});

	it("names each broken rule with its fix", () => {
		const m = manifestOf({
			thing: [
				{ id: "t.one", fields: { uses: ["w.gone", "-"] } as never },
				{ id: "t.one" },
				{ id: "t.listed" },
			],
			widget: [],
		});
		const c = live({
			"a.things.ts": {
				t: entry("thing", { id: "t.one" }),
				u: entry("thing", { id: "t.unlisted", label: "U" }),
			},
		});
		expect(formatProblems(runGuards(kinds, m, c))).toEqual([
			'[thing/schema] thing "t.one": label must be a string. Fix: Make the definition match its kind\'s schema.',
			'[thing/unique] thing "t.one" is defined twice (athing). Fix: Rename one of the two definitions; an id names one thing.',
			'[thing/fresh] thing "t.unlisted" runs but the manifest does not list it. Fix: Run `pnpm registry gen` and commit registry.gen.ts and registry.manifest.json.',
			'[thing/fresh] thing "t.listed" is in the manifest but nothing defines it. Fix: Run `pnpm registry gen` and commit registry.gen.ts and registry.manifest.json.',
			'[thing/refs] thing "t.one" uses names widget "w.gone", which does not exist. Fix: Use an id that exists (`pnpm registry ls <kind>`), or define it first.',
			'[widget/populated] kind "widget" has no entries. Fix: Add a first entry with `pnpm new <kind> <id>`, or remove the kind.',
		]);
	});

	it("flags a kind the manifest lacks, and a manifest kind nobody registers", () => {
		const m = manifestOf({ widget: [] });
		const { thing: _t, ...rest } = m.kinds;
		const stale: Manifest = { ...m, kinds: { ...rest, gadget: rest.widget as never } };
		const problems = runGuards([thing], stale, live({}));
		expect(problems.map((p) => `${p.kind}/${p.guard}: ${p.problem}`)).toEqual([
			'widget/fresh: kind "widget" is in the manifest but not registered',
			'gadget/fresh: kind "gadget" is in the manifest but not registered',
			'thing/fresh: kind "thing" is missing from the manifest',
		]);
	});

	it("reports duplicates and misplaced entries the collector found", () => {
		const w = entry("widget", { id: "w.one", label: "W" });
		const problems = runGuards(
			[widget],
			{ ...manifestOf({ widget: [{ id: "w.one" }] }), kinds: { widget: manifestOf({}).kinds.widget as never } },
			live({ "a.widgets.ts": { w, again: w }, "b.things.ts": { x: entry("widget", { id: "w.x", label: "X" }) } }),
		);
		expect(problems.map((p) => `${p.guard}: ${p.problem}`)).toEqual([
			"collect: widget:w.one (a.widgets.ts)",
			"placement: widget:w.x (b.things.ts)",
		]);
	});
});
