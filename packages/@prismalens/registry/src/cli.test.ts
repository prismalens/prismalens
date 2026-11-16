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
import { main } from "./cli.ts";

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
		const out = (log.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("widget");
	});

	it("lists entries of a specific kind and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "ls", "widget"]);
		expect(code).toBe(0);
		const out = (log.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("w.one");
	});
});

describe("where", () => {
	it("prints the kind info for a known thing and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "where", "a widget"]);
		expect(code).toBe(0);
		const out = (log.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("widget");
	});

	it("prints usage to stderr and returns 1 when no argument is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "where"]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});
});

describe("brief", () => {
	it("prints the brief text with a hash and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		// Use w.one, which is a registered surface-like entry in the manifest.
		// brief is printed for whatever surfaces are passed; output always has 'brief-hash:'.
		const code = main(["--config", cfgFile, "brief", "w.one"]);
		expect(code).toBe(0);
		const out = (log.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("brief-hash:");
	});

	it("prints usage to stderr and returns 1 when no surface is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "brief"]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});
});

describe("profile", () => {
	it("prints problems to stderr and returns 1 when the name is unknown", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "profile", "nope"]);
		expect(code).toBe(1);
		// profileConditions writes each problem line via fail().
		const lines = err.mock.calls.map((c) => c[0] as string);
		expect(lines.some((l) => l.includes("nope"))).toBe(true);
	});

	it("prints usage to stderr and returns 1 when no name is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "profile"]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
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
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});

	it("prints usage to stderr and returns 1 when no command is given", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});
});

describe("render", () => {
	it("render bar prints tables and returns 0", () => {
		const log = vi.spyOn(console, "log").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "render", "bar"]);
		expect(code).toBe(0);
		// renderRun writes <!-- registry:... --> marker blocks
		const out = (log.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("<!-- registry:");
	});

	it("prints usage to stderr and returns 1 when subcommand is not 'bar'", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "render", "other"]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});
});

describe("judge-pack", () => {
	it("prints usage to stderr and returns 1 when required flags are missing", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		// cp is supplied but --template, --out, --references are missing
		const code = main(["--config", cfgFile, "judge-pack", "cp4"]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});
});

describe("score-check", () => {
	it("prints usage to stderr and returns 1 when scores and stamps are missing", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "score-check"]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});
});

describe("new", () => {
	it("prints usage to stderr and returns 1 when kind or id is missing", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		const code = main(["--config", cfgFile, "new"]);
		expect(code).toBe(1);
		const out = (err.mock.calls[0]?.[0] as string) ?? "";
		expect(out).toContain("usage:");
	});

	it("prints the error to stderr and returns 1 when planEntry throws", () => {
		const err = vi.spyOn(console, "error").mockReturnValue(undefined);
		// 'widget' kind exists but 'w.one' already exists in the fixture entry file
		const code = main(["--config", cfgFile, "new", "widget", "w.one"]);
		expect(code).toBe(1);
		const lines = err.mock.calls.map((c) => c[0] as string);
		expect(lines.length).toBeGreaterThan(0);
	});
});
