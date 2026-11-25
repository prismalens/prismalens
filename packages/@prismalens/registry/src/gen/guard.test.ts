// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../cli.ts";
import { HEADER } from "../ratchet.ts";
import { git } from "./git.ts";
import { ratchetGuard } from "./guard.ts";
import { guardLabelCheck } from "./label-run.ts";
import { loadWorkspace } from "./workspace.ts";

const L9 = fileURLToPath(
	new URL(
		"../../../../frontend/biome-plugins/registry/l9-hand-list.grit",
		import.meta.url,
	),
);

const KIND = `import { defineKind } from "@prismalens/registry";
export const widget = defineKind({
	name: "widget",
	suffix: ".widgets.ts",
	about: "A test widget.",
	schema,
	refs: {},
	guards: [labelled],
	define: defineWidget,
});`;

const entry = (name: string) =>
	`export const ${name} = define.widget({ id: "w.${name}", label: "${name}" });\n`;

let root = "";
const put = (rel: string, text: string) => {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
};

const workspace = (extra: Record<string, unknown> = {}, rule = "w") =>
	put(
		"registry.workspace.json",
		JSON.stringify({
			hosts: ["registry.config.json"],
			ids: { host: "registry.config.json", kind: "widget" },
			guard: {
				ratchet: "registry.ratchet.tsv",
				lint: "registry.lint.json",
				forbid: [
					{
						rule: "id-handmade",
						fix: "Read it from the widget registry",
						ids: rule,
						allow: ["packages/a/src/declares/"],
					},
				],
				protected: ["registry.lint.json"],
			},
			...extra,
		}),
	);

/** Runs `registry ratchet`, returning its exit code and the lines it printed as errors. */
const ratchet = (...args: string[]) => {
	const err = vi.spyOn(console, "error").mockReturnValue(undefined);
	vi.spyOn(console, "log").mockReturnValue(undefined);
	const code = main([
		"--config",
		join(root, "registry.config.json"),
		"ratchet",
		...args,
	]);
	const lines = err.mock.calls.map(([l]) => String(l));
	vi.restoreAllMocks();
	return { code, lines };
};

const tsv = () => readFileSync(join(root, "registry.ratchet.tsv"), "utf8");

const rose = (file: string, rule: string, n: number, fix: string) =>
	`${file}: ${rule} rose from 0 to ${n}. ${fix}; a raise needs the operator's label on the PR.`;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "registry-guard-"));
	put("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
	put("packages/a/package.json", "{}");
	put("packages/a/src/ok.ts", "export {};\n");
	put("src/registry/kinds/widget.ts", KIND);
	put("src/a/b.widgets.ts", entry("one") + entry("two"));
	put("src/design/.keep", "");
	put(
		"registry.config.json",
		JSON.stringify({
			workspace: "registry.workspace.json",
			src: "src",
			kinds: "src/registry/kinds",
			out: "src/registry",
			gallery: "src/design",
		}),
	);
	mkdirSync(join(root, "plugins"));
	copyFileSync(L9, join(root, "plugins/l9.grit"));
	put(
		"registry.lint.json",
		JSON.stringify({
			linter: { enabled: true, rules: { preset: "none" } },
			plugins: ["./plugins/l9.grit"],
		}),
	);
	workspace();
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("the workspace guard", () => {
	it("fails a hand list in a package added after the baseline, naming the registry read", () => {
		expect(ratchet("--write")).toEqual({ code: 0, lines: [] });
		put("packages/b/package.json", "{}");
		put("packages/b/src/x.ts", 'export const L = ["one", "two"];\n');
		expect(ratchet()).toEqual({
			code: 1,
			lines: [
				rose(
					"packages/b/src/x.ts",
					"id-handmade",
					2,
					"Read it from the widget registry",
				),
			],
		});
	});

	it("covers a newly registered member with no rule edit", () => {
		put(
			"packages/a/src/x.ts",
			'export const f = (k: string) => { switch (k) { case "three": return 1; } };\n',
		);
		expect(ratchet("--write")).toEqual({ code: 0, lines: [] });
		expect(tsv()).toBe(`${HEADER}\n`);
		put("src/a/c.widgets.ts", entry("three"));
		expect(ratchet().lines).toEqual([
			rose(
				"packages/a/src/x.ts",
				"id-handmade",
				1,
				"Read it from the widget registry",
			),
		]);
	});

	it("counts a list of { id, label } objects through the L9 plugin", () => {
		put(
			"packages/a/src/x.ts",
			'export const ROWS = [{ id: "a", label: "A" }];\n',
		);
		expect(ratchet("--write")).toEqual({ code: 0, lines: [] });
		expect(tsv()).toBe(`${HEADER}\npackages/a/src/x.ts\tL9\t1\n`);
	});

	it("leaves out build output, generated files, allowed dirs and what a host's ratchet counts", () => {
		const list = 'export const L = ["one"];\n';
		for (const f of [
			"packages/a/dist/x.ts",
			"packages/a/generated/x.ts",
			"packages/a/src/x.gen.ts",
			"packages/a/src/declares/x.ts",
			"packages/a/src/x.test.ts",
			"packages/ui/src/x.ts",
			"packages/ui/top.ts",
		])
			put(f, list);
		put("packages/ui/package.json", "{}");
		put(
			"packages/ui/registry.config.json",
			JSON.stringify({
				src: "src",
				kinds: "src/kinds",
				out: "src",
				ratchet: "ratchet.tsv",
			}),
		);
		workspace({
			hosts: ["registry.config.json", "packages/ui/registry.config.json"],
		});
		// The host's own ratchet needs its app; the guard's TSV is what this reads.
		const ws = loadWorkspace(join(root, "registry.workspace.json"));
		expect(ratchetGuard(ws, true)).toEqual([]);
		expect(tsv()).toBe(`${HEADER}\npackages/ui/top.ts\tid-handmade\t1\n`);
	});

	it("counts ids under a host's other ratchet dirs, leaving its text rules and test lints to it", () => {
		put("packages/ui/package.json", "{}");
		put(
			"packages/ui/registry.config.json",
			JSON.stringify({
				src: "src",
				kinds: "src/kinds",
				out: "src",
				ratchet: "ratchet.tsv",
				ratchetDirs: ["src", "e2e"],
			}),
		);
		put(
			"packages/ui/e2e/seed.ts",
			'export const L = ["one"] as never;\nexport const R = [{ id: "a", label: "A" }];\n',
		);
		workspace({
			hosts: ["registry.config.json", "packages/ui/registry.config.json"],
		});
		const ws = loadWorkspace(join(root, "registry.workspace.json"));
		expect(ratchetGuard(ws, true)).toEqual([]);
		expect(tsv()).toBe(
			`${HEADER}\npackages/ui/e2e/seed.ts\tL9\t1\npackages/ui/e2e/seed.ts\tid-handmade\t1\n`,
		);
	});

	it("names a rule whose family the id host does not list", () => {
		workspace({}, "nope");
		expect(ratchet()).toEqual({
			code: 1,
			lines: [
				'[workspace/ids] forbid rule id-handmade reads the ids of "nope", but the id host lists no nope.* entry. Fix: register its first member (pnpm new provider nope.<member>) or drop the rule\'s ids.',
			],
		});
	});

	it("fails when the package list matches nothing", () => {
		put("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
		expect(ratchet()).toEqual({
			code: 1,
			lines: [
				"[workspace/guard] pnpm-workspace.yaml matches no package, so the guard would scan nothing. Fix: restore its packages list.",
			],
		});
	});

	it("fails on a file the lint cannot parse", () => {
		put("packages/a/src/x.ts", "export const = ;\n");
		expect(ratchet().lines).toEqual([
			"[workspace/guard] packages/a/src/x.ts does not parse under registry.lint.json. Fix: correct the file, or the lint config's parser options.",
		]);
	});
});

// Each case spawns git a dozen times, which passes 5 s on a loaded Windows machine.
describe("the guard's label check", { timeout: 30_000 }, () => {
	const run = (...args: string[]) => git(args, { cwd: root }).trim();
	const commit = () => {
		run("add", "-A");
		run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
		return run("rev-parse", "HEAD");
	};
	const check = (base: string, head: string, labels = "") =>
		guardLabelCheck(
			loadWorkspace(join(root, "registry.workspace.json")),
			base,
			head,
			labels,
		);
	const fix = 'Fix: undo it, or ask the operator to add the "registry-approved" label.';
	const body = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n";
	const rows = (...r: string[]) => `${HEADER}\n${r.join("\n")}\n`;

	beforeEach(() => {
		run("init", "-q");
		put("packages/a/src/old.ts", body);
		put("registry.ratchet.tsv", rows("packages/a/src/old.ts\tL9\t2"));
	});

	it("asks for the label on a change to the guard's lint config, a protected path", () => {
		const base = commit();
		put("registry.lint.json", "{}");
		const head = commit();
		expect(check(base, head)).toEqual([
			`registry.lint.json is a registry guard path. ${fix}`,
		]);
		expect(check(base, head, "registry-approved")).toEqual([]);
	});

	it("asks for the label when a protected path is renamed away", () => {
		const base = commit();
		run("mv", "registry.lint.json", "other.json");
		const head = commit();
		expect(check(base, head)).toEqual([
			`registry.lint.json is a registry guard path. ${fix}`,
		]);
	});

	it("carries a renamed file's rows, so a pure move needs no label", () => {
		const base = commit();
		run("mv", "packages/a/src/old.ts", "packages/a/src/new.ts");
		put("registry.ratchet.tsv", rows("packages/a/src/new.ts\tL9\t2"));
		expect(check(base, commit())).toEqual([]);
	});

	it("asks for the label when a moved file gains a hit", () => {
		const base = commit();
		run("mv", "packages/a/src/old.ts", "packages/a/src/new.ts");
		put("registry.ratchet.tsv", rows("packages/a/src/new.ts\tL9\t3"));
		expect(check(base, commit())).toEqual([
			`packages/a/src/new.ts L9 rose from 2 to 3 in registry.ratchet.tsv. ${fix}`,
		]);
	});

	it("asks for the label when the ratchet is renamed away", () => {
		const base = commit();
		run("mv", "registry.ratchet.tsv", "backup.tsv");
		expect(check(base, commit())).toEqual([
			`registry.ratchet.tsv was removed. ${fix}`,
		]);
	});

	it("asks for the label on a protected path git would quote", () => {
		workspace();
		const base = commit();
		put("guarded/na\u00efve.ts", "export {};\n");
		const head = commit();
		const ws = loadWorkspace(join(root, "registry.workspace.json"));
		const guard = {
			ratchet: "registry.ratchet.tsv",
			lint: "registry.lint.json",
			protected: ["guarded/"],
		};
		expect(guardLabelCheck({ ...ws, guard }, base, head, "")).toEqual([
			`guarded/na\u00efve.ts is a registry guard path. ${fix}`,
		]);
	});

	it("compares from the fork point, so the base branch's own changes neither hide nor add a rise", () => {
		const fork = commit();
		put("registry.ratchet.tsv", rows("packages/a/src/old.ts\tL9\t3"));
		const base = commit();
		run("checkout", "-q", fork);
		put("README.md", "unrelated\n");
		const unrelated = commit();
		expect(check(base, unrelated)).toEqual([]);
		put("registry.ratchet.tsv", rows("packages/a/src/old.ts\tL9\t3"));
		expect(check(base, commit())).toEqual([
			`packages/a/src/old.ts L9 rose from 2 to 3 in registry.ratchet.tsv. ${fix}`,
		]);
	});

	// Git answers with the real path, so the config's own may not be under it (macOS's /var).
	it("reads the ratchet and its renames when the workspace is reached through a link", () => {
		const base = commit();
		run("mv", "packages/a/src/old.ts", "packages/a/src/new.ts");
		put("registry.ratchet.tsv", rows("packages/a/src/new.ts	L9	3"));
		const head = commit();
		const links = mkdtempSync(join(tmpdir(), "registry-link-"));
		try {
			const link = join(links, "repo");
			symlinkSync(root, link, "junction");
			const ws = loadWorkspace(join(link, "registry.workspace.json"));
			expect(guardLabelCheck(ws, base, head, "")).toEqual([
				`packages/a/src/new.ts L9 rose from 2 to 3 in registry.ratchet.tsv. ${fix}`,
			]);
		} finally {
			rmSync(links, { recursive: true, force: true });
		}
	});

	it("asks for the label when the scanned package list changes, not for another edit to the file", () => {
		const base = commit();
		put("pnpm-workspace.yaml", "packages:\n  - packages/*\ncatalog:\n  zod: ^4\n");
		const catalog = commit();
		expect(check(base, catalog)).toEqual([]);
		put("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
		expect(check(base, commit())).toEqual([
			`pnpm-workspace.yaml changes the packages the guard scans. ${fix}`,
		]);
	});
});
