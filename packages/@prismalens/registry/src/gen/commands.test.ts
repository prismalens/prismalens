// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { Manifest, ManifestKind } from "../manifest.ts";
import { fill, ls, namesOf, planEntry, planKind, rank, where } from "./commands.ts";

const kind = (k: Partial<ManifestKind> & { suffix: string }): ManifestKind => ({
	file: "k.ts",
	about: "",
	refs: {},
	guards: ["labelled"],
	aliases: [],
	keywords: [],
	...k,
});

const manifest: Manifest = {
	version: 1,
	kinds: {
		action: kind({
			suffix: ".actions.ts",
			about: "Something a user runs from a menu.",
			keywords: ["menu", "palette", "shortcut"],
			guards: ["labelled", "reachable"],
			scaffold: {
				dir: "src/components/{{object}}",
				imports: ['import { define } from "@/registry/define";'],
				entry: 'export const {{name}} = define.action({ id: "{{id}}", label: "{{label}}" });',
				object: {
					imports: ['import { defineObject } from "@/kit/actions";'],
					entry: 'export const {{object}}Object = defineObject<{{Object}}Ctx>("{{object}}");',
				},
			},
		}),
		surface: kind({
			suffix: ".surface.ts",
			about: "An object on screen.",
			keywords: ["row", "card"],
			guards: ["labelled", "galleryStates"],
			scaffold: {
				dir: "src/components/{{object}}",
				imports: [],
				entry: 'export const {{name}} = define.surface({ id: "{{id}}", states: { default: "{{slug}}", phone: "{{slug}}" } });',
			},
		}),
		setting: kind({ suffix: ".settings.ts", about: "A setting.", keywords: ["preference"] }),
	},
	entries: {
		action: [
			{ id: "thread.archive", file: "src/shell/thread.actions.ts", export: "a", fields: { id: "thread.archive", label: "Archive" } },
			{ id: "thread.pin", file: "src/shell/thread.actions.ts", export: "p", fields: { id: "thread.pin" } },
		],
		surface: [
			{ id: "thread.row", file: "src/shell/thread.surface.ts", export: "r", fields: { id: "thread.row", menus: { more: ["thread.pin", "-"] } } },
		],
		setting: [
			{ id: "list.density", file: "src/settings/list.settings.ts", export: "d", fields: { id: "list.density", label: "Density", surfaces: ["thread.row"] } },
		],
	},
	gallery: [],
	uses: {},
};

describe("names and templates", () => {
	it("derives every placeholder from an id", () => {
		expect(namesOf("diffFile.copyPath")).toEqual({
			id: "diffFile.copyPath",
			object: "diffFile",
			Object: "DiffFile",
			name: "diffFileCopyPath",
			label: "Copy path",
			lower: "copy path",
			slug: "diff-file-copy-path",
		});
	});

	it("fills known placeholders and leaves unknown ones", () => {
		expect(fill("{{id}} {{nope}}", { id: "a.b" })).toBe("a.b {{nope}}");
	});
});

describe("where", () => {
	it("ranks by kind name, then keywords, then the about line", () => {
		expect(rank(manifest, "a palette entry on a row")).toEqual([
			{ kind: "action", score: 3 },
			{ kind: "surface", score: 3 },
		]);
		expect(rank(manifest, "new settings for a menu")[0]).toEqual({ kind: "setting", score: 5 });
	});

	it("answers with the file, an example, the command, the guards and the runners-up", () => {
		expect(where(manifest, "a shortcut in the palette menu")).toBe(
			[
				"action: Something a user runs from a menu.",
				'  file:     src/components/<object>/<object>.actions.ts, one exported define.action({ id: "<object>.<name>", ... }) per entry',
				"  example:  src/shell/thread.actions.ts (thread.archive)",
				"  scaffold: pnpm new action <object>.<name>",
				"  guards:   unique, fresh, refs, populated, labelled, reachable",
			].join("\n"),
		);
	});

	it("says to add a kind, not a list, when nothing fits", () => {
		expect(where(manifest, "a teapot")).toBe(
			[
				'No kind fits "a teapot". Kinds: action, surface, setting.',
				"If it is a new kind of thing a user can see, run, set or bind: pnpm new kind <name>.",
				"Never hand-write a list of { id, label } objects.",
			].join("\n"),
		);
	});
});

describe("ls", () => {
	it("counts each kind", () => {
		expect(ls(manifest)).toBe("action\t2\t.actions.ts\nsurface\t1\t.surface.ts\nsetting\t1\t.settings.ts");
	});

	it("lists a surface's actions and the settings that shape it", () => {
		expect(ls(manifest, "action", "thread.row")).toBe("thread.pin\t\tsrc/shell/thread.actions.ts");
		expect(ls(manifest, "setting", "thread.row")).toBe("list.density\tDensity\tsrc/settings/list.settings.ts");
	});

	it("names the kinds when asked for one that does not exist", () => {
		expect(ls(manifest, "gadget")).toBe('No kind "gadget". Kinds: action, surface, setting.');
	});
});

describe("new <kind> <id>", () => {
	const files: Record<string, string> = {
		"src/shell/thread.actions.ts": `// header\n\nimport { x } from "y";\n\nexport const threadObject = defineObject<ThreadCtx>("thread");\n`,
		"src/design/gallery.registry.tsx": "export const registryGallery = [\n];\n",
	};
	const read = (f: string) => files[f] ?? null;

	it("appends to a declared object's file: the import and the entry, plus a test stub", () => {
		const declared: Manifest = { ...manifest, objects: [{ name: "thread", file: "src/shell/thread.actions.ts", export: "threadObject" }] };
		const { edits, next } = planEntry(declared, "action", "thread.mute", read);
		expect(edits.map((e) => [e.file, e.created])).toEqual([
			["src/shell/thread.actions.ts", false],
			["src/shell/thread.actions.test.ts", true],
		]);
		expect(edits[0]?.text).toBe(
			`// header\n\nimport { x } from "y";\nimport { define } from "@/registry/define";\n\nexport const threadObject = defineObject<ThreadCtx>("thread");\n\nexport const threadMute = define.action({ id: "thread.mute", label: "Mute" });\n`,
		);
		expect(edits[1]?.text).toContain('it.todo("thread.mute: assert what it does at its public seam");');
		expect(next).toEqual([
			"Fill in src/shell/thread.actions.ts.",
			'Place "thread.mute" in a surface\'s menus, or the reachable guard fails.',
			"Write the test in the stub, then run pnpm --filter @prismalens/frontend ui:check:static.",
		]);
	});

	it("declares an object that has no defineObject yet, once, before its first entry", () => {
		const { edits } = planEntry(manifest, "action", "inbox.open", read);
		expect(edits[0]?.text).toBe(
			`// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Sumit Patel\n\nimport { define } from "@/registry/define";\nimport { defineObject } from "@/kit/actions";\n\nexport const inboxObject = defineObject<InboxCtx>("inbox");\n\nexport const inboxOpen = define.action({ id: "inbox.open", label: "Open" });\n`,
		);
	});

	it("starts a new object's file beside its other kinds, and stubs a gallery section for a drawn kind", () => {
		const { edits } = planEntry(manifest, "surface", "thread.card", read, { gallery: "src/design/gallery.registry.tsx" });
		expect(edits.map((e) => [e.file, e.created])).toEqual([
			["src/shell/thread.surface.ts", true],
			["src/shell/thread.surface.test.ts", true],
			["src/design/gallery.registry.tsx", false],
		]);
		const fresh = planEntry(manifest, "surface", "inbox.row", read, { gallery: "src/design/gallery.registry.tsx" });
		expect(fresh.edits[0]?.file).toBe("src/components/inbox/inbox.surface.ts");
		expect(fresh.edits[0]?.created).toBe(true);
		expect(fresh.edits[2]?.text).toBe(
			'export const registryGallery = [\n\t{\n\t\tid: "inbox-row",\n\t\ttitle: "inbox.row",\n\t\trender: () => <div data-kit-state="inbox-row">inbox.row: draw its default and phone states</div>,\n\t},\n];\n',
		);
	});

	it("refuses an existing id, a malformed id and a kind with no scaffold", () => {
		expect(() => planEntry(manifest, "action", "thread.pin", read)).toThrow('action "thread.pin" already exists.');
		expect(() => planEntry(manifest, "action", "Pin", read)).toThrow('"Pin" is not an id: write <object>.<name>, e.g. thread.archive.');
		expect(() => planEntry(manifest, "setting", "list.size", read)).toThrow(
			'No kind "setting" with a scaffold. Kinds: action, surface, setting.',
		);
	});
});

describe("new kind <name>", () => {
	const read = (f: string) =>
		f === "src/registry/kinds/index.ts"
			? 'import { action } from "./action";\n\nexport const kinds = [action] as const;\n'
			: null;

	it("writes the kind, lists it, and adds an L1 plugin scoped away from its suffix", () => {
		const plan = planKind("chip", { kinds: "src/registry/kinds", plugins: "biome-plugins/registry", src: "packages/frontend/src" }, read);
		expect(plan.edits.map((e) => e.file)).toEqual([
			"src/registry/kinds/chip.ts",
			"src/registry/kinds/index.ts",
			"biome-plugins/registry/l1-chip.grit",
		]);
		expect(plan.edits[0]?.text).toContain('suffix: ".chips.ts",');
		expect(plan.edits[1]?.text).toBe(
			'import { action } from "./action";\nimport { chip } from "./chip";\n\nexport const kinds = [action, chip] as const;\n',
		);
		expect(plan.edits[2]?.text).toContain("`define.chip($def)` as $call");
		expect(plan.plugin).toEqual({
			path: "biome-plugins/registry/l1-chip.grit",
			includes: [
				"packages/frontend/src/**",
				"!packages/frontend/src/**/*.chips.ts",
				"!packages/frontend/src/**/*.test.ts",
				"!packages/frontend/src/**/*.test.tsx",
			],
		});
	});

	it("refuses a name that is not one camelCase word, and a kind that exists", () => {
		const paths = { kinds: "k", plugins: "p", src: "s" };
		expect(() => planKind("my-kind", paths, read)).toThrow('"my-kind" is not a kind name: one camelCase word, e.g. chip.');
		expect(() => planKind("chip", paths, () => "exists")).toThrow("k/chip.ts exists.");
	});
});
