// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Manifest } from "../manifest.ts";
import { toLiteral } from "./modules.ts";
import { boundaryProblems, mergeManifests } from "./workspace.ts";

let root = "";
const put = (f: string, text: string) => {
	mkdirSync(dirname(join(root, f)), { recursive: true });
	writeFileSync(join(root, f), text);
};
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

const BOUNDARIES = [
	{ from: "packages/frontend/src", deny: ["@prismalens/providers/server"], why: "screens read providers from the API." },
	{ from: "packages/@prismalens/agent-host/src", deny: ["@prismalens/registry", "@prismalens/providers"], why: "agent-host stays a leaf." },
	{ from: "packages/@prismalens/providers/src", deny: ["@prismalens/api"], why: "providers import no app code." },
];

describe("boundaryProblems", () => {
	it("names one forbidden import in each of three packages, by file and specifier", () => {
		root = mkdtempSync(join(tmpdir(), "registry-ws-"));
		put("packages/frontend/src/a.tsx", 'import { x } from "@prismalens/providers/server";\n');
		put("packages/frontend/src/ok.tsx", 'import { x } from "@prismalens/providers";\n');
		put("packages/@prismalens/agent-host/src/b.ts", 'const r = await import("@prismalens/registry/gen");\n');
		put("packages/@prismalens/providers/src/c.ts", 'export * from "@prismalens/api";\n');
		put("packages/@prismalens/providers/src/node_modules/d.ts", 'import "@prismalens/api";\n');
		expect(boundaryProblems(root, BOUNDARIES)).toEqual([
			"[workspace/boundary] packages/frontend/src/a.tsx imports @prismalens/providers/server. Fix: screens read providers from the API.",
			"[workspace/boundary] packages/@prismalens/agent-host/src/b.ts imports @prismalens/registry/gen. Fix: agent-host stays a leaf.",
			"[workspace/boundary] packages/@prismalens/providers/src/c.ts imports @prismalens/api. Fix: providers import no app code.",
		]);
	});
});

const manifest = (kinds: string[], file: string): Manifest => ({
	version: 1,
	kinds: Object.fromEntries(kinds.map((k) => [k, { file, suffix: `.${k}.ts`, about: k, refs: {}, guards: [], aliases: [], keywords: [k] }])),
	entries: Object.fromEntries(kinds.map((k) => [k, [{ id: `${k}.one`, file, export: "one", fields: {} }]])),
	gallery: [],
	uses: {},
});

describe("mergeManifests", () => {
	it("joins each host's kinds and entries into one view", () => {
		const { manifest: m, problems } = mergeManifests([manifest(["action"], "fe"), manifest(["provider"], "pv")]);
		expect(problems).toEqual([]);
		expect(Object.keys(m.kinds)).toEqual(["action", "provider"]);
		expect(m.entries.provider?.map((e) => e.id)).toEqual(["provider.one"]);
	});

	it("names a kind two hosts both declare", () => {
		expect(mergeManifests([manifest(["action"], "fe"), manifest(["action"], "pv")]).problems).toEqual([
			'[workspace/kinds] kind "action" is declared by fe and pv. Fix: rename one; a kind belongs to one host.',
		]);
	});
});

describe("toLiteral", () => {
	it("keeps plain data and drops functions and class instances such as schemas", () => {
		class Schema {}
		expect(toLiteral({ id: "a", n: 1, ok: true, none: null, list: ["x", () => 1], run: () => 1, schema: new Schema(), nested: { s: "y" } })).toEqual({
			id: "a",
			n: 1,
			ok: true,
			none: null,
			list: ["x"],
			nested: { s: "y" },
		});
	});
});
