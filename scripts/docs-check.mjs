// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Every Markdown file in the repo has a word budget, and names only paths and pnpm
 * scripts that exist. Agents follow prose literally, so a long or stale doc steers
 * them wrong (#1212). Budgets live in scripts/docs-budgets.json.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

const PNPM_BUILTINS = new Set(
	"add audit config create dlx exec install i import init licenses link list ls outdated pack prune publish rebuild remove rm root run setup store test unlink update up why approve-builds".split(
		" ",
	),
);
const PROVENANCE =
	/\b20\d\d-[01]\d-[0-3]\d\b|\b[Ss]ince #\d+|\b[Bb]orn 20\d\d|\badded after 20\d\d/;
const PATH_EXT =
	/\.(?:md|mjs|cjs|js|ts|tsx|mts|json|jsonc|ya?ml|sh|ps1|prisma|sql|grit|tsv|toml|txt|css|html)$/;

/** Prose lines of a Markdown file: fenced code blocks blanked, so examples are data. */
export function proseLines(text) {
	let fence = false;
	return text.split(/\r?\n/).map((line) => {
		if (/^\s*(```|~~~)/.test(line)) {
			fence = !fence;
			return "";
		}
		return fence ? "" : line;
	});
}

export function countWords(text) {
	return proseLines(text).join(" ").split(/\s+/).filter(Boolean).length;
}

/** Repo paths a doc names: link targets and code spans that look like a file path. */
export function namedPaths(line) {
	const out = [];
	for (const m of line.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g))
		if (!/^[a-z]+:/i.test(m[1])) out.push(m[1]);
	for (const m of line.matchAll(/`([^`\s]+)`/g)) {
		const p = m[1].replace(/:\d+(?:-\d+)?$/, "");
		// `repo:path` names a file in another repo (`prismalens.io:docs/POLICY.md`).
		if (/[*{}<>$~]|^\.\.?$|^[-@]|^[\w.-]+:/.test(p)) continue;
		if (p.includes("/") ? PATH_EXT.test(p) || p.endsWith("/") : false)
			out.push(p);
	}
	return out;
}

/** `pnpm <script>` and `pnpm --filter <pkg> <script>` references in a line. */
export function namedScripts(line) {
	const out = [];
	for (const m of line.matchAll(
		/`pnpm\s+(?:--filter[= ](\S+)\s+)?([a-z][\w:.-]*)[^`]*`/g,
	))
		out.push({ pkg: m[1] ?? null, script: m[2] });
	return out;
}

const BINARY =
	/\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|zip|gz|tgz|wasm|db)$/i;

/** Any tracked file that points a reader at an agent's private notes, which no reader can open. */
export function privateNotes(file, text) {
	return text
		.split(/\r?\n/)
		.flatMap((line, i) =>
			/(?:^|[\s"'`(])~?\/?ai-context\//.test(line)
				? [
						`${file}:${i + 1}: points at an agent's private notes; put the record in an issue`,
					]
				: [],
		);
}

/** Finds every problem in one doc. `ctx` answers which paths and scripts exist. */
export function checkDoc(file, text, budget, ctx) {
	const problems = [];
	const words = countWords(text);
	if (budget === undefined)
		problems.push(
			`${file}: no word budget; add it to scripts/docs-budgets.json (it has ${words} words)`,
		);
	else if (words > budget)
		problems.push(
			`${file}: ${words} words, budget ${budget}; cut, or move detail to a reference the core links`,
		);
	proseLines(text).forEach((line, i) => {
		const at = `${file}:${i + 1}`;
		const dated = PROVENANCE.exec(line);
		if (dated)
			problems.push(
				`${at}: "${dated[0]}" is history; state the rule as it stands and leave the story to git or an issue`,
			);
		for (const p of namedPaths(line))
			if (!ctx.pathExists(file, p))
				problems.push(
					`${at}: names \`${p}\`, which does not exist (another repo's file is written \`repo:path\`)`,
				);
		for (const { pkg, script } of namedScripts(line))
			if (!ctx.scriptExists(file, pkg, script))
				problems.push(
					`${at}: names \`pnpm ${pkg ? `--filter ${pkg} ` : ""}${script}\`, which is not a script`,
				);
	});
	return problems;
}

export function repoContext(root, files) {
	const pkgs = new Map();
	for (const f of files.filter((f) => f.endsWith("package.json"))) {
		const json = JSON.parse(readFileSync(join(root, f), "utf8"));
		pkgs.set(json.name, new Set(Object.keys(json.scripts ?? {})));
	}
	const rootScripts = new Set(
		Object.keys(
			JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts,
		),
	);
	const tracked = new Set(files);
	const docPkgScripts = (doc) => {
		for (let d = posix.dirname(doc); d !== "."; d = posix.dirname(d))
			if (tracked.has(`${d}/package.json`))
				return pkgs.get(
					JSON.parse(readFileSync(join(root, d, "package.json"), "utf8")).name,
				);
		return undefined;
	};
	for (const f of files)
		for (let d = posix.dirname(f); d !== "."; d = posix.dirname(d))
			tracked.add(d);
	const ignored = (rel) => {
		try {
			execFileSync("git", ["check-ignore", "-q", "--no-index", rel], {
				cwd: root,
			});
			return true;
		} catch {
			return false;
		}
	};
	return {
		// A path may be repo-rooted, relative to the doc, a unique-enough suffix of a
		// tracked path (`lib/trigger.ts` in a package doc), or a gitignored build output.
		pathExists(doc, p) {
			const rel = p.replace(/^\.?\//, "").replace(/\/$/, "");
			if (tracked.has(rel) || tracked.has(posix.join(posix.dirname(doc), rel)))
				return true;
			for (const t of tracked) if (t.endsWith(`/${rel}`)) return true;
			let pkg = posix.dirname(doc);
			while (pkg !== "." && !tracked.has(`${pkg}/package.json`))
				pkg = posix.dirname(pkg);
			const slash = p.endsWith("/") ? "/" : "";
			return [
				rel,
				posix.join(posix.dirname(doc), rel),
				posix.join(pkg, rel),
			].some((c) => ignored(c + slash));
		},
		// Unfiltered `pnpm x` runs from the root, or from the package the doc lives in.
		scriptExists(doc, pkg, script) {
			if (PNPM_BUILTINS.has(script)) return true;
			if (pkg) return pkgs.get(pkg)?.has(script) ?? false;
			return (
				rootScripts.has(script) || (docPkgScripts(doc)?.has(script) ?? false)
			);
		},
	};
}

export function gitFiles(root) {
	return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
		.split("\n")
		.filter(Boolean);
}

export function run(root) {
	const files = gitFiles(root);
	const { budgets } = JSON.parse(
		readFileSync(join(root, "scripts", "docs-budgets.json"), "utf8"),
	);
	const ctx = repoContext(root, files);
	const docs = files.filter(
		(f) => f.endsWith(".md") && !/(^|\/)CHANGELOG\.md$/.test(f),
	);
	const problems = docs.flatMap((f) =>
		checkDoc(f, readFileSync(join(root, f), "utf8"), budgets[f], ctx),
	);
	for (const f of files.filter((f) => !BINARY.test(f)))
		problems.push(...privateNotes(f, readFileSync(join(root, f), "utf8")));
	for (const f of Object.keys(budgets))
		if (!docs.includes(f))
			problems.push(`scripts/docs-budgets.json: ${f} has a budget but no file`);
	return problems;
}

if (import.meta.main) {
	const problems = run(dirname(import.meta.dirname));
	if (problems.length) {
		console.error(problems.join("\n"));
		process.exit(1);
	}
	console.log(
		"docs: every file within budget, every named path and script exists",
	);
}
