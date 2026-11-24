// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const API = fileURLToPath(new URL("..", import.meta.url));

function specs(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		if (e.isDirectory()) return e.name === "node_modules" ? [] : specs(path);
		return e.name.endsWith(".spec.ts") ? [path] : [];
	});
}
const all = [...specs(join(API, "src")), ...specs(join(API, "test"))].map(
	(p) => relative(API, p).replaceAll("\\", "/"),
);

it("gives every medium file its own timeout, so none runs on the 5 s default (#1154)", () => {
	const missing = all
		.filter((f) => f.endsWith(".int.spec.ts"))
		.filter(
			(f) =>
				!/vi\.setConfig\(\{[^}]*testTimeout: [\d_]+/.test(
					readFileSync(join(API, f), "utf8"),
				),
		);
	expect(missing).toEqual([]);
});
