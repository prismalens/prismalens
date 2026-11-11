#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Tests nightlyVersion and writeVersion in scripts/nightly-version.mjs.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nightlyVersion, writeVersion } from "./nightly-version.mjs";

test("computes next patch nightly version", () => {
	const version = nightlyVersion({
		stable: "0.5.3",
		date: "20261111",
		run: 812,
	});
	assert.equal(version, "0.5.4-nightly.20261111.812");
});

test("throws when computed nightly is below published nightly above", () => {
	assert.throws(
		() =>
			nightlyVersion({
				stable: "0.5.3",
				date: "20261111",
				run: 812,
				above: "0.5.4-nightly.20261112.900",
			}),
		(err) => {
			assert(err instanceof Error);
			assert.equal(
				err.message,
				"0.5.4-nightly.20261111.812 is below the published nightly 0.5.4-nightly.20261112.900",
			);
			return true;
		},
	);
});

test("returns computed nightly when above is equal to the result (re-run)", () => {
	const version = nightlyVersion({
		stable: "0.5.3",
		date: "20261111",
		run: 812,
		above: "0.5.4-nightly.20261111.812",
	});
	assert.equal(version, "0.5.4-nightly.20261111.812");
});

test("throws on invalid stable, date, or run arguments", () => {
	assert.throws(
		() => nightlyVersion({ stable: "0.5.4-rc.1", date: "20261111", run: 1 }),
		/the stable version "0.5.4-rc.1" isn't a plain x\.y\.z/,
	);
	assert.throws(
		() => nightlyVersion({ stable: "0.5.3", date: "2026-11-11", run: 1 }),
		/the date "2026-11-11" isn't YYYYMMDD/,
	);
	assert.throws(
		() => nightlyVersion({ stable: "0.5.3", date: "20261111", run: "0" }),
		/the run number "0" isn't a positive integer/,
	);
});

test("writeVersion on temp package.json with tabs keeps other fields and writes version with tabs", () => {
	const dir = join(
		tmpdir(),
		`nightly-version-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	const pkgPath = join(dir, "package.json");
	try {
		const initialPkg = {
			name: "prismalens",
			version: "0.5.3",
			description: "Local-first incident investigator",
		};
		writeFileSync(
			pkgPath,
			`${JSON.stringify(initialPkg, null, "\t")}\n`,
			"utf8",
		);

		writeVersion(pkgPath, "0.5.4-nightly.20261111.812");

		const raw = readFileSync(pkgPath, "utf8");
		assert.match(raw, /"version": "0\.5\.4-nightly\.20261111\.812"/);
		assert(raw.includes('\t"name": "prismalens"'));
		assert(raw.includes('\t"version": "0.5.4-nightly.20261111.812"'));
		assert(
			raw.includes('\t"description": "Local-first incident investigator"'),
		);

		const parsed = JSON.parse(raw);
		assert.equal(parsed.name, "prismalens");
		assert.equal(parsed.version, "0.5.4-nightly.20261111.812");
		assert.equal(parsed.description, "Local-first incident investigator");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
