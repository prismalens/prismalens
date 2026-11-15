#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Every child process the app or the sim starts passes `windowsHide: true`, in the call's own
// options literal. Without it, a server running with no console opens a console window per
// child on Windows: a background `pl up` polling git opened hundreds (#1101). Held at zero.
//   node scripts/check-spawn-hidden.mjs [--list]
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(
	join(ROOT, "packages/@prismalens/registry/package.json"),
)("typescript");

/** Product code and the sim; tests and fixtures start their own children and are left out. */
const DIRS = [
	"packages/api/src",
	"packages/cli/src",
	...readdirSync(join(ROOT, "packages/@prismalens")).map(
		(p) => `packages/@prismalens/${p}/src`,
	),
	"scripts/sim",
];
const SKIP = /(\.(test|spec)\.|__fixtures__|\/e2e\/|\.d\.m?ts$)/;
const CHILD = new Set(["node:child_process", "child_process"]);
const CALLS = new Set([
	"spawn",
	"spawnSync",
	"exec",
	"execSync",
	"execFile",
	"execFileSync",
	"fork",
]);

function files(dir) {
	const out = [];
	let names;
	try {
		names = readdirSync(join(ROOT, dir), { recursive: true });
	} catch {
		return out;
	}
	for (const n of names) {
		const f = `${dir}/${String(n).split("\\").join("/")}`;
		if (
			/\.(m?[jt]sx?)$/.test(f) &&
			!SKIP.test(f) &&
			!f.includes("node_modules")
		)
			out.push(f);
	}
	return out;
}

/** True when `node` is an object literal with `windowsHide: true`. */
function hides(node) {
	return (
		node &&
		ts.isObjectLiteralExpression(node) &&
		node.properties.some(
			(p) =>
				ts.isPropertyAssignment(p) &&
				p.name.getText() === "windowsHide" &&
				p.initializer.kind === ts.SyntaxKind.TrueKeyword,
		)
	);
}

function check(file) {
	const text = readFileSync(join(ROOT, file), "utf8");
	const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	/** Local name → true for a child_process function, cross-spawn, or a promisified one. */
	const fns = new Set();
	const spaces = new Set();
	for (const s of src.statements) {
		if (!ts.isImportDeclaration(s) || !s.importClause) continue;
		const from = s.moduleSpecifier.text;
		const c = s.importClause;
		if (from === "cross-spawn") {
			if (c.name) {
				fns.add(c.name.text);
				spaces.add(c.name.text);
			}
			continue;
		}
		if (!CHILD.has(from)) continue;
		if (c.name) spaces.add(c.name.text);
		const b = c.namedBindings;
		if (b && ts.isNamespaceImport(b)) spaces.add(b.name.text);
		if (b && ts.isNamedImports(b))
			for (const e of b.elements)
				if (CALLS.has((e.propertyName ?? e.name).text)) fns.add(e.name.text);
	}
	if (!fns.size && !spaces.size) return [];
	const bad = [];
	const visit = (n) => {
		// const run = promisify(execFile): `run` is a spawn too.
		if (
			ts.isVariableDeclaration(n) &&
			ts.isIdentifier(n.name) &&
			n.initializer &&
			ts.isCallExpression(n.initializer) &&
			/promisify$/.test(n.initializer.expression.getText()) &&
			n.initializer.arguments[0] &&
			fns.has(n.initializer.arguments[0].getText())
		)
			fns.add(n.name.text);
		if (ts.isCallExpression(n)) {
			const e = n.expression;
			const hit =
				(ts.isIdentifier(e) && fns.has(e.text)) ||
				(ts.isPropertyAccessExpression(e) &&
					ts.isIdentifier(e.expression) &&
					spaces.has(e.expression.text) &&
					(CALLS.has(e.name.text) || e.name.text === "sync"));
			if (hit && !n.arguments.some(hides)) {
				const { line } = src.getLineAndCharacterOfPosition(n.getStart());
				bad.push(
					`${file}:${line + 1}: ${e.getText()}(…) without windowsHide: true`,
				);
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(src);
	return bad;
}

const bad = DIRS.flatMap(files).flatMap(check);
for (const b of bad) console.error(b);
if (bad.length) {
	console.error(
		`\n${bad.length} child process call(s) without windowsHide: true in their options literal. Add it: on Windows each one opens a console window.`,
	);
	process.exitCode = 1;
} else console.log("spawn-hidden: every child process call hides its window");
