#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// SPDX header check/fix for first-party source files.
//
//   node scripts/spdx-headers.mjs --check   # exit 1 listing files missing the header (CI)
//   node scripts/spdx-headers.mjs --fix     # insert the header where missing
//
// Scope: git-tracked *.ts / *.tsx / *.mts / *.cts / *.mjs / *.cjs files,
// excluding generated code (see EXCLUDE). Policy lives in CONTRIBUTING.md.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const HEADER_LINES = [
	"// SPDX-License-Identifier: Apache-2.0",
	"// Copyright 2026 Sumit Patel",
];
const SPDX_MARKER = "SPDX-License-Identifier:";

// Path substrings that mark generated or third-party code — never headered.
const EXCLUDE = [
	"/paraglide/", // paraglide i18n compiler output (packages/frontend/src/lib/paraglide)
	"/generated/", // any generated client (e.g. prisma output)
	"/dist/",
	"/.turbo/",
];

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--fix") {
	console.error("usage: node scripts/spdx-headers.mjs --check|--fix");
	process.exit(2);
}

const files = execFileSync(
	"git",
	["ls-files", "*.ts", "*.tsx", "*.mts", "*.cts", "*.mjs", "*.cjs"],
	{ encoding: "utf8" },
)
	.split("\n")
	.filter(Boolean)
	// *.gen.* files are build-regenerated (e.g. TanStack Router's routeTree.gen.ts)
	// — a header inserted there is lost on the next build.
	.filter((f) => !/\.gen\.[^/]+$/.test(f))
	.filter((f) => !EXCLUDE.some((ex) => `/${f}`.includes(ex)));

const missing = [];
for (const file of files) {
	const content = readFileSync(file, "utf8");
	// Only the first few lines count — a stray SPDX string deep in a file is not a header.
	const head = content.split("\n", 5).join("\n");
	if (head.includes(SPDX_MARKER)) continue;
	missing.push(file);
	if (mode === "--fix") {
		let out;
		if (content.startsWith("#!")) {
			const nl = content.indexOf("\n");
			out = `${content.slice(0, nl + 1)}${HEADER_LINES.join("\n")}\n\n${content.slice(nl + 1)}`;
		} else {
			out = `${HEADER_LINES.join("\n")}\n\n${content}`;
		}
		writeFileSync(file, out);
	}
}

if (mode === "--check") {
	if (missing.length > 0) {
		console.error(`${missing.length} file(s) missing the SPDX header:`);
		for (const f of missing) console.error(`  ${f}`);
		console.error("\nRun: pnpm spdx:fix");
		process.exit(1);
	}
	console.log(`SPDX headers OK (${files.length} files).`);
} else {
	console.log(
		`Inserted SPDX header into ${missing.length} file(s); ${files.length} in scope.`,
	);
}
