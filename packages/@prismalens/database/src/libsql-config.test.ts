// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { expandConfig } from "@libsql/core/config";
import { afterEach, describe, expect, it } from "vitest";
import { libsqlConfig, libsqlFileUrl } from "./libsql-config.js";

/** The local path @libsql/client will open for a URL. */
const pathOf = (url: string) => expandConfig({ url }, true).path;

describe("libsqlFileUrl", () => {
	it.each([
		["/home/op/.prismalens/prismalens.db"],
		["/home/op/my workspace/prismalens.db"],
		["/home/op/100%/prismalens.db"],
		["/home/op/what?/prismalens.db"],
		["/home/op/#1/prismalens.db"],
		["/home/op/%3F already-encoded/prismalens.db"],
		["C:\\Users\\op\\.prismalens\\prismalens.db"],
		["C:\\Users\\a b\\x%y?#.db"],
		["\\\\server\\share\\prismalens\\prismalens.db"],
	])("round-trips %s through libsql's URL parser", (path) => {
		expect(pathOf(libsqlFileUrl(path))).toBe(path);
	});

	describe("on a real file", () => {
		let dir: string | undefined;
		afterEach(() => {
			if (dir) rmSync(dir, { recursive: true, force: true });
		});

		it("opens the exact path, however awkward its characters", async () => {
			dir = mkdtempSync(join(tmpdir(), "pl libsql %?#-"));
			const file = join(dir, "pris ma%20lens?.db");
			const client = createClient({ url: libsqlFileUrl(file) });
			await client.execute("CREATE TABLE t (x INTEGER)");
			client.close();

			const reopened = createClient({ url: libsqlFileUrl(file) });
			const rows = await reopened.execute(
				"SELECT name FROM sqlite_master WHERE name = 't'",
			);
			reopened.close();
			expect(rows.rows).toHaveLength(1);
		});
	});
});

describe("libsqlConfig", () => {
	it("builds the adapter config with the busy timeout", () => {
		expect(
			libsqlConfig("/data/prismalens.db", { readonly: false, timeout: 5000 }),
		).toEqual({ url: "file:/data/prismalens.db", timeout: 5000 });
	});

	it("refuses PRISMALENS_DB_SQLITE_READONLY rather than ignoring it", () => {
		expect(() =>
			libsqlConfig("/data/prismalens.db", { readonly: true, timeout: 5000 }),
		).toThrow(/PRISMALENS_DB_SQLITE_READONLY/);
	});
});
