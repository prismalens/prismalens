// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, USAGE } from "./cli.ts";

// A minimal kind module that generate() can read.
const KIND_SRC = `import { defineKind } from "@prismalens/registry";
export const widget = defineKind({
	name: "widget",
	suffix: ".widgets.ts",
	about: "A test widget.",
	schema,
	refs: {},
	guards: [labelled],
	define: defineWidget,
});`;

// A minimal entry file that the generator collects.
const ENTRY_SRC = `export const w = define.widget({ id: "w.one", label: "One" });`;

let root = "";
let cfgFile = "";

/** Writes a file relative to root, creating parent dirs. */
const put = (rel: string, text: string) => {
	mkdirSync(join(root, rel, ".."), { recursive: true });
	writeFileSync(join(root, rel), text);
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "registry-cli-"));
	put("src/registry/kinds/widget.ts", KIND_SRC);
	put("src/a/b.widgets.ts", ENTRY_SRC);
	put("src/design/.keep", "");
	cfgFile = join(root, "registry.config.json");
	writeFileSync(
		cfgFile,
		JSON.stringify({
			src: "src",
			kinds: "src/registry/kinds",
			out: "src/registry",
			gallery: "src/design",
		}),
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	if (root) rmSync(root, { recursive: true, force: true });
});

describe("gen", () => {
	it("writes the generated files and prints 'registry: generated', returning 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "gen"]);
		expect(code).toBe(0);
		expect(log).toHaveBeenCalledWith("registry: generated");
	});
});

describe("ls", () => {
	it("lists all kinds and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "ls"]);
		expect(code).toBe(0);
		// The output is a tab-separated table; each line names a kind.
		expect(log.mock.calls).toEqual([["widget\t1\t.widgets.ts"]]);
	});

	it("lists entries of a specific kind and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "ls", "widget"]);
		expect(code).toBe(0);
		expect(log.mock.calls).toEqual([["w.one\tOne\tsrc/a/b.widgets.ts"]]);
	});
});

describe("where", () => {
	it("prints the kind info for a known thing and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "where", "a widget"]);
		expect(code).toBe(0);
		expect(log.mock.calls).toEqual([
			[
				[
					"widget: A test widget.",
					'  file:     *.widgets.ts, one exported define.widget({ id: "<object>.<name>", ... }) per entry',
					"  example:  src/a/b.widgets.ts (w.one)",
					"  scaffold: pnpm new widget <object>.<name>",
					"  guards:   unique, fresh, refs, populated, labelled",
				].join("\n"),
			],
		]);
	});

	it("prints usage to stderr and returns 1 when no argument is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "where"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});
});

describe("brief", () => {
	it("prints the brief text with a hash and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		// Use w.one, which is a registered surface-like entry in the manifest.
		// brief is printed for whatever surfaces are passed; output always has 'brief-hash:'.
		const code = main(["--config", cfgFile, "brief", "w.one"]);
		expect(code).toBe(0);
		expect(log.mock.calls).toEqual([
			[
				[
					"Conditions and lenses in force on w.one (from the registry; do not retype):",
					"- no condition applies to these surfaces",
					"Open debt: none.",
					"brief-hash: a8d5bf9c6047",
				].join("\n"),
			],
		]);
	});

	it("prints usage to stderr and returns 1 when no surface is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "brief"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});
});

describe("profile", () => {
	it("prints problems to stderr and returns 1 when the name is unknown", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "profile", "nope"]);
		expect(code).toBe(1);
		// profileConditions writes each problem line via fail().
		expect(err.mock.calls).toEqual([
			[
				'no profile or condition "nope": profiles are , or a condition id (pnpm registry ls condition)',
			],
		]);
	});

	it("prints usage to stderr and returns 1 when no name is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "profile"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});

	it("--seeds prints an empty string and returns 0 when the profile has no seeds", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		// 'bare' is not registered in the fixture, so profileSeeds returns []; seeds.join("\n") is "".
		const code = main(["--config", cfgFile, "profile", "bare", "--seeds"]);
		expect(code).toBe(0);
		expect(log).toHaveBeenCalledWith("");
	});
});

describe("ratchet", () => {
	it("holds when the ratchet is fresh-written, returning 0 and printing 'ratchet: holds'", () => {
		// ratchet-run spawns biome; pass a pre-written JSON report to skip the spawn.
		const reportFile = "biome-report.json";
		// The report parser looks for {"summary" in the text; zero diagnostics is valid.
		put(reportFile, '{"summary":{},"diagnostics":[]}');

		const ratchetPath = "ratchet.tsv";
		writeFileSync(
			cfgFile,
			JSON.stringify({
				src: "src",
				kinds: "src/registry/kinds",
				out: "src/registry",
				gallery: "src/design",
				ratchet: ratchetPath,
				ratchetDirs: ["src"],
			}),
		);

		// Write the current counts using the pre-written report; that always succeeds.
		const log1 = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code1 = main(["--config", cfgFile, "ratchet", "--write", "--report", reportFile, "--report-cwd", "."]);
		expect(code1).toBe(0);
		expect(log1).toHaveBeenCalledWith("ratchet: written");
		vi.restoreAllMocks();

		// A second read against the just-written file must hold.
		const log2 = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code2 = main(["--config", cfgFile, "ratchet", "--report", reportFile, "--report-cwd", "."]);
		expect(code2).toBe(0);
		expect(log2).toHaveBeenCalledWith("ratchet: holds");
	});
});

describe("unknown command and missing argument", () => {
	it("prints usage to stderr and returns 1 for an unknown command", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "frobnicate"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});

	it("prints usage to stderr and returns 1 when no command is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});
});

describe("render", () => {
	it("render bar prints tables and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "render", "bar"]);
		expect(code).toBe(0);
		// renderRun writes <!-- registry:... --> marker blocks
		expect(log.mock.calls).toEqual([
			[
				[
					"<!-- registry:categories -->",
					"| # | Category | Area | Walks | Conditions |",
					"| :-- | :-- | :-- | :-- | :-- |",
					"<!-- /registry:categories -->",
					"",
					"<!-- registry:walks -->",
					"| Walk | Title | Categories | Surfaces |",
					"| :-- | :-- | :-- | :-- |",
					"<!-- /registry:walks -->",
					"",
					"<!-- registry:conditions -->",
					"| Condition | Status | Categories | Walks | Simulator | CI | What is measured |",
					"| :-- | :-- | :-- | :-- | :-- | :-- | :-- |",
					"<!-- /registry:conditions -->",
				].join("\n"),
			],
		]);
	});

	it("prints usage to stderr and returns 1 when subcommand is not 'bar'", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "render", "other"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});
});

describe("judge-pack", () => {
	it("prints usage to stderr and returns 1 when required flags are missing", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		// cp is supplied but --template, --out, --references are missing
		const code = main(["--config", cfgFile, "judge-pack", "cp4"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});
});

describe("score-check", () => {
	it("prints usage to stderr and returns 1 when scores and stamps are missing", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "score-check"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});
});

describe("new", () => {
	it("prints usage to stderr and returns 1 when kind or id is missing", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "new"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([[USAGE]]);
	});

	it("prints why it cannot scaffold to stderr and returns 1 when the kind has no scaffold", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "new", "widget", "w.one"]);
		expect(code).toBe(1);
		expect(err.mock.calls).toEqual([
			['No kind "widget" with a scaffold. Kinds: widget.'],
		]);
	});
});

describe("a host that names its workspace", () => {
	const workspace = (boundaries: unknown[], others: string[] = []) => {
		put(
			"registry.workspace.json",
			JSON.stringify({
				hosts: ["registry.config.json", ...others],
				boundaries,
			}),
		);
		writeFileSync(
			cfgFile,
			JSON.stringify({
				workspace: "registry.workspace.json",
				src: "src",
				kinds: "src/registry/kinds",
				out: "src/registry",
				gallery: "src/design",
			}),
		);
	};

	it("fails gen on an import across a boundary, naming the file, the specifier and the fix", () => {
		workspace([
			{ from: "src/a", deny: ["@acme/server"], why: "screens read it from the API." },
		]);
		put("src/a/screen.tsx", 'import { x } from "@acme/server/adapter";\n');
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		expect(main(["--config", cfgFile, "gen"])).toBe(1);
		expect(err.mock.calls).toEqual([
			[
				"[workspace/boundary] src/a/screen.tsx imports @acme/server/adapter. Fix: screens read it from the API.",
			],
		]);
	});

	it("lists the workspace's kinds through the host's config", () => {
		put(
			"other/registry.config.json",
			JSON.stringify({
				src: "src",
				kinds: "src/registry/kinds",
				out: "src/registry",
				gallery: "src/design",
			}),
		);
		put(
			"other/src/registry/kinds/gadget.ts",
			KIND_SRC.replaceAll("widget", "gadget").replace(
				"defineWidget",
				"defineGadget",
			),
		);
		put(
			"other/src/a/b.gadgets.ts",
			'export const g = define.gadget({ id: "g.one", label: "One" });',
		);
		put("other/src/design/.keep", "");
		workspace([], ["other/registry.config.json"]);
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		expect(main(["--config", cfgFile, "ls"])).toBe(0);
		expect(log.mock.calls).toEqual([
			["widget\t1\t.widgets.ts\ngadget\t1\t.gadgets.ts"],
		]);
	});
});
