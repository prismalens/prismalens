// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main } from "@prismalens/registry/cli";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "./registry.ts";

const PKG = fileURLToPath(new URL("..", import.meta.url));
// Inside the package, so the copy resolves zod and the registry from its node_modules.
const ROOT = join(PKG, ".tmp", `new-provider-${process.pid}`);
const CFG = join(ROOT, "registry.config.json");
const DESCRIPTOR = join(ROOT, "src/code-host/fixturehost/fixturehost.provider.ts");

const run = (...args: string[]) => {
	const out: string[] = [];
	const err: string[] = [];
	const log = vi.spyOn(console, "log").mockImplementation((s) => void out.push(String(s)));
	const error = vi.spyOn(console, "error").mockImplementation((s) => void err.push(String(s)));
	try {
		return { code: main(["--config", CFG, ...args]), out, err };
	} finally {
		log.mockRestore();
		error.mockRestore();
	}
};

beforeAll(() => {
	rmSync(ROOT, { recursive: true, force: true });
	mkdirSync(ROOT, { recursive: true });
	cpSync(join(PKG, "src"), join(ROOT, "src"), {
		recursive: true,
		filter: (f) => !f.endsWith(".test.ts"),
	});
	writeFileSync(
		CFG,
		JSON.stringify({ collect: "module", src: "src", kinds: "src/kinds", out: "src" }),
	);
	writeFileSync(
		join(ROOT, "src/code-host.entry-points.ts"),
		`import { defineEntryPoint } from "./descriptor.ts";
export const projectsAdd = defineEntryPoint({
	id: "projects.add",
	family: "code-host",
	required: true,
	about: "Add project lists every code host.",
	screen: "packages/frontend/src/components/projects/AddProjectDialog.tsx",
});
`,
	);
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe("pnpm registry new provider", () => {
	it("writes a descriptor that lists its family's required entry points, its fixtures, and a barrel the registry loads", async () => {
		const made = run("new", "provider", "code-host.fixturehost");
		expect(made.err).toEqual([]);
		expect(made.code).toBe(0);
		expect(made.out.join("\n")).toContain(
			"wrote src/code-host/fixturehost/fixturehost.provider.ts",
		);
		expect(readFileSync(DESCRIPTOR, "utf8")).toContain('entryPoints: ["projects.add"]');
		expect(
			JSON.parse(readFileSync(join(ROOT, "src/code-host/fixturehost/fixtures/rejected.json"), "utf8")),
		).toEqual({ status: 401, body: {} });

		const gen = run("gen");
		expect(gen.err).toEqual([]);
		expect(gen.code).toBe(0);
		const barrel = await import(pathToFileURL(join(ROOT, "src/registry.gen.ts")).href);
		const registry = new ProviderRegistry(barrel.builtIn);
		expect(registry.list("code-host").map((p) => p.id)).toEqual(["code-host.fixturehost"]);
		expect(run("ls", "provider").out.join("\n")).toContain("code-host.fixturehost");
	});

	it("fails gen, naming the member and the entry point, once the descriptor drops a required entry point", () => {
		const text = readFileSync(DESCRIPTOR, "utf8");
		writeFileSync(DESCRIPTOR, text.replace('entryPoints: ["projects.add"]', "entryPoints: []"));
		const gen = run("gen");
		expect(gen.code).toBe(1);
		expect(gen.err.join("\n")).toContain(
			"[provider/entry-point-required] code-host.fixturehost misses projects.add",
		);
		writeFileSync(DESCRIPTOR, text);
	});
});

describe("pnpm registry new provider agent.<id>", () => {
	it("writes an agent descriptor through the family's variant: its launch row, the agent entry points and its stored ids", () => {
		const made = run("new", "provider", "agent.fixtureagent");
		expect(made.err).toEqual([]);
		expect(made.code).toBe(0);
		const text = readFileSync(join(ROOT, "src/agent/fixtureagent/fixtureagent.provider.ts"), "utf8");
		expect(text).toContain('import { defineAgent, noModeLines } from "../family.ts";');
		expect(text).toContain('launch: "fixtureagent",');
		expect(text).toContain(
			'entryPoints: ["composer.agent-picker","incidents.first-run","settings.agents"],',
		);
		expect(text).toContain('{ column: "Run.harness", value: "fixtureagent" },');
		const gen = run("gen");
		expect(gen.err).toEqual([]);
		expect(gen.code).toBe(0);
	});
});
