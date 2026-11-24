// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import {
	checkDoc,
	countWords,
	gitFiles,
	repoContext,
	run,
} from "./docs-check.mjs";

const real = { pathExists: () => true, scriptExists: () => true };

test("words inside a fenced block do not count toward the budget", () => {
	assert.equal(countWords("one two\n```bash\nthree four five\n```\nsix\n"), 3);
});

test("a doc over its budget fails with its count and budget", () => {
	assert.deepEqual(checkDoc("AGENTS.md", "a b c d\n", 3, real), [
		"AGENTS.md: 4 words, budget 3; cut, or move detail to a reference the core links",
	]);
});

test("a doc with no budget fails, so a new doc is a deliberate size", () => {
	assert.deepEqual(checkDoc("NEW.md", "a b\n", undefined, real), [
		"NEW.md: no word budget; add it to scripts/docs-budgets.json (it has 2 words)",
	]);
});

test("a dated policy line fails: the test-first rule that outlived its policy", () => {
	assert.deepEqual(
		checkDoc(
			"CONTRIBUTING.md",
			"2. **Work test-first (repo policy since #58)**\n",
			100,
			real,
		),
		[
			'CONTRIBUTING.md:1: "since #58" is history; state the rule as it stands and leave the story to git or an issue',
		],
	);
});

test("a path that no longer exists fails; another repo's `repo:path` is skipped", () => {
	const ctx = {
		...real,
		pathExists: (_doc, p) => p !== "scripts/setup-repo.sh",
	};
	assert.deepEqual(
		checkDoc(
			"README.md",
			"Run `scripts/setup-repo.sh`, then read `prismalens.io:docs/POLICY.md`.\n",
			100,
			ctx,
		),
		[
			"README.md:1: names `scripts/setup-repo.sh`, which does not exist (another repo's file is written `repo:path`)",
		],
	);
});

test("a pnpm script the root does not have fails: `pnpm ui:check` lives in the frontend", () => {
	const ctx = {
		...real,
		scriptExists: (_doc, pkg, s) =>
			pkg === "@prismalens/frontend" && s === "ui:check",
	};
	assert.deepEqual(
		checkDoc(
			"AGENTS.md",
			"Run `pnpm ui:check`, or `pnpm --filter @prismalens/frontend ui:check`.\n",
			100,
			ctx,
		),
		["AGENTS.md:1: names `pnpm ui:check`, which is not a script"],
	);
});

test("the repo's own docs pass", () => {
	assert.deepEqual(run(dirname(import.meta.dirname)), []);
});

test("in this repo, paths resolve from the root, the doc or a gitignored output", () => {
	const root = dirname(import.meta.dirname);
	const ctx = repoContext(root, gitFiles(root));
	assert.deepEqual(
		[
			ctx.pathExists("AGENTS.md", "scripts/setup-repo.sh"),
			ctx.pathExists("AGENTS.md", "scripts/ci-plan.mjs"),
			ctx.pathExists("packages/frontend/e2e/README.md", "e2e/.features-gen/"),
		],
		[false, true, true],
	);
});

test("in this repo, unfiltered `pnpm ui:check` resolves only inside the frontend", () => {
	const root = dirname(import.meta.dirname);
	const ctx = repoContext(root, gitFiles(root));
	assert.deepEqual(
		[
			ctx.scriptExists("AGENTS.md", null, "ui:check"),
			ctx.scriptExists(
				"packages/frontend/design/GUIDELINES.md",
				null,
				"ui:check",
			),
			ctx.scriptExists("AGENTS.md", "@prismalens/frontend", "ui:check"),
		],
		[false, true, true],
	);
});
