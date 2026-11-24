// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What a `CI` run runs for a given push (#1052, #1053), with the package tiers read from turbo's own graph. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { parse } from "yaml";
import { plan, TIER_PACKAGES, turboPackages } from "./ci-plan.mjs";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");
const turbo = [
	process.execPath,
	createRequire(join(ROOT, "package.json")).resolve("turbo/bin/turbo"),
];

/** The workspace's packages as their own manifests declare them: name, path, and the workspace packages each uses. */
function workspace() {
	const found = [];
	for (const base of ["packages", "packages/@prismalens"])
		for (const entry of readdirSync(join(ROOT, base), {
			withFileTypes: true,
		})) {
			const path = `${base}/${entry.name}`;
			let manifest;
			try {
				manifest = JSON.parse(
					readFileSync(join(ROOT, path, "package.json"), "utf8"),
				);
			} catch {
				continue;
			}
			found.push({ name: manifest.name, path, manifest });
		}
	const names = new Set(found.map((p) => p.name));
	return found.map(({ name, path, manifest }) => ({
		name,
		path,
		uses: Object.keys({
			...manifest.dependencies,
			...manifest.devDependencies,
		}).filter((d) => names.has(d)),
	}));
}

const PACKAGES = workspace();

/** A throwaway git repo with this workspace's packages and their dependency edges, for turbo to read. */
function fixtureRepo() {
	const dir = mkdtempSync(join(tmpdir(), "ci-plan-"));
	const write = (/** @type {string} */ file, /** @type {unknown} */ body) => {
		mkdirSync(dirname(join(dir, file)), { recursive: true });
		writeFileSync(
			join(dir, file),
			typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`,
		);
	};
	write("package.json", {
		name: "fixture-root",
		private: true,
		packageManager: "pnpm@9.15.0",
	});
	write(
		"pnpm-workspace.yaml",
		"packages:\n  - packages/*\n  - packages/@prismalens/*\n",
	);
	write("turbo.json", { tasks: { build: {} } });
	write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
	for (const p of PACKAGES)
		write(`${p.path}/package.json`, {
			name: p.name,
			version: "0.0.0",
			dependencies: Object.fromEntries(p.uses.map((d) => [d, "workspace:*"])),
		});
	/** Edits a file the way its format allows, so turbo can still parse the manifests and the lockfile. */
	const touch = (/** @type {string} */ f) => {
		const at = join(dir, f);
		const body = existsSync(at) ? readFileSync(at, "utf8") : null;
		if (body === null) write(f, `changed ${f}\n`);
		else if (f.endsWith(".json"))
			write(f, { ...JSON.parse(body), description: "changed" });
		else write(f, `${body}# changed\n`);
	};
	const git = (/** @type {string[]} */ ...args) =>
		execFileSync(
			"git",
			["-c", "user.name=t", "-c", "user.email=t@t", ...args],
			{ cwd: dir, encoding: "utf8" },
		);
	git("init", "-q", "-b", "main");
	git("add", "-A");
	git("commit", "-q", "-m", "base");
	return {
		dir,
		/** Commits a change to each file and returns what turbo lists as affected, and the packages. */
		change(/** @type {string[]} */ files) {
			for (const f of files) touch(f);
			git("add", "-A");
			git("commit", "-q", "-m", "change");
			return {
				packages: turboPackages({ turbo, cwd: dir }),
				affected: turboPackages({
					turbo,
					cwd: dir,
					affected: { base: "main~1", head: "HEAD" },
				}).map((p) => p.name),
			};
		},
	};
}

/** @type {string[]} */
const repos = [];
const pr = (/** @type {Parameters<typeof plan>[0]} */ over) =>
	plan({ event: "pull_request", files: [], ...over });
/** The plan for a PR that changes `files`, with what turbo says of them in a fixture repo of this workspace. */
function planFor(/** @type {string[]} */ files, over = {}) {
	const repo = fixtureRepo();
	repos.push(repo.dir);
	const { packages, affected } = repo.change(files);
	return {
		affected,
		...pr({ files, packages, affected, ...over }),
	};
}
after(() => {
	for (const dir of repos) rmSync(dir, { recursive: true, force: true });
});

/** The tiers in the order skip, code, e2e, intake, full, agents. */
const tiers = (/** @type {ReturnType<typeof plan>} */ p) => [
	p.skip,
	p.code,
	p.e2e,
	p.intake,
	p.full,
	p.agents,
];
const NOTHING = [true, false, false, false, false, false];
const EVERYTHING = [false, true, true, true, true, true];

before(() => {
	assert.ok(PACKAGES.length >= 12, "the workspace's packages were not found");
});

test("turbo lists a changed package with its dependents, from the repo's own package graph", () => {
	const repo = fixtureRepo();
	repos.push(repo.dir);
	const { packages, affected } = repo.change([
		"packages/@prismalens/contracts/src/a.ts",
	]);
	assert.deepEqual(affected.sort(), [
		"@prismalens/api",
		"@prismalens/contracts",
		"@prismalens/engine",
		"@prismalens/frontend",
		"@prismalens/integrations",
		"prismalens",
	]);
	assert.equal(packages.length, PACKAGES.length);
});

test("a frontend-only change turns on the browser suite and the build the sim specs run on, and nothing else", () => {
	const p = planFor(["packages/frontend/src/routes/index.tsx"]);
	assert.deepEqual(p.affected, ["@prismalens/frontend"]);
	// `code` is what starts proofs.yml's sim specs on a PR.
	assert.deepEqual(tiers(p), [false, true, true, false, false, false]);
});

test("an engine change turns on the agent legs, the browser suite and the intake", () => {
	const p = planFor(["packages/@prismalens/engine/src/run/investigate.ts"]);
	assert.deepEqual(p.affected.sort(), [
		"@prismalens/api",
		"@prismalens/engine",
		"prismalens",
	]);
	assert.deepEqual(tiers(p), [false, true, true, true, false, true]);
});

test("a change to a package the engine depends on turns the agent legs on; one it does not depend on leaves them off", () => {
	const contracts = planFor(["packages/@prismalens/contracts/src/a.ts"]);
	assert.equal(contracts.agents, true);
	const database = planFor(["packages/@prismalens/database/src/a.ts"]);
	assert.equal(database.agents, false);
	assert.equal(database.intake, true);
	const adapters = planFor(["packages/@prismalens/agent-adapters/src/a.ts"]);
	assert.equal(adapters.agents, true);
});

test("a desktop-only change builds and tests, and runs neither the browser suite nor the tarball intake", () => {
	const p = planFor(["packages/desktop/src/main.ts"]);
	assert.deepEqual(tiers(p), [false, true, false, false, false, false]);
});

test("a file on no plan rule at the root turns every tier on and names itself", () => {
	const p = planFor(["Dockerfile"]);
	assert.deepEqual(tiers(p), EVERYTHING);
	assert.equal(p.reason, "Dockerfile is on no plan rule: everything runs");
});

test("an unknown script and an unknown directory turn every tier on, so a new tool is never skipped", () => {
	for (const file of ["scripts/new-tool.mjs", "tools/gen.mjs", ".nvmrc"])
		assert.deepEqual(tiers(planFor([file])), EVERYTHING, file);
});

test("a docs-only PR runs nothing; a package README is not docs", () => {
	assert.deepEqual(
		tiers(pr({ files: ["README.md", "CONTRIBUTING.md"] })),
		NOTHING,
	);
	const readme = planFor(["packages/cli/README.md"]);
	assert.equal(readme.skip, false);
	assert.equal(readme.code, true);
});

test("repo metadata and the CI-only scripts and workflows run lint and its script tests, and no build", () => {
	const p = planFor([
		"docs/guide.md",
		".github/workflows/release.yml",
		"scripts/ci-plan.mjs",
		"scripts/workflow-pins.test.mjs",
	]);
	assert.deepEqual(tiers(p), [false, false, false, false, false, false]);
	assert.equal(p.reason, "CI-only paths: lint and its script tests");
});

test("a change to ci.yml runs every tier; one to the browser workflow builds and runs the browser suite", () => {
	assert.deepEqual(tiers(planFor([".github/workflows/ci.yml"])), EVERYTHING);
	assert.deepEqual(tiers(planFor([".github/workflows/e2e-browser.yml"])), [
		false,
		true,
		true,
		false,
		false,
		false,
	]);
});

test("an agent pin or the admission fake turns the qualification legs on without a build", () => {
	for (const file of ["scripts/agent-pins.json", "scripts/admission-fake.mjs"])
		assert.deepEqual(
			tiers(planFor([file])),
			[false, false, false, false, false, true],
			file,
		);
});

test("the lockfile and root manifests build every package and run the agent legs, but not the release proofs", () => {
	for (const file of ["pnpm-lock.yaml", "package.json"])
		assert.deepEqual(
			tiers(planFor([file])),
			[false, true, true, true, false, true],
			file,
		);
});

test("a change to packaging, the gate scripts or the workflows that run the proofs turns the release proofs on", () => {
	for (const file of [
		"scripts/pack-cli.mjs",
		"scripts/gate-side-checks.mjs",
		"scripts/lib/service-proof.mjs",
	])
		assert.equal(planFor([file]).full, true, file);
	// proofs.yml also runs the agent legs, so editing it runs those too.
	assert.deepEqual(tiers(planFor([".github/workflows/proofs.yml"])), [
		false,
		false,
		false,
		false,
		true,
		true,
	]);
});

test("a change to the CLI's own sources turns the release proofs on; its tests and the api do not", () => {
	for (const file of [
		"packages/cli/src/cli/service.ts",
		"packages/cli/src/cli/doctor.ts",
		"packages/cli/src/new-command.ts",
	])
		assert.equal(planFor([file]).full, true, file);
	for (const file of [
		"packages/cli/src/cli/service.test.ts",
		"packages/cli/README.md",
		"packages/api/src/a.ts",
	])
		assert.equal(planFor([file]).full, false, file);
});

test("a renamed file counts under both names, so a source file moved into docs still runs its checks", () => {
	const p = planFor(["docs/api.md", "packages/api/src/main.ts"]);
	assert.deepEqual(tiers(p), [false, true, true, true, false, false]);
});

test("a push to main runs the PR checks and leaves the release proofs to the nightly", () => {
	for (const event of ["push", "schedule"]) {
		const p = plan({ event, files: ["README.md"] });
		assert.deepEqual(tiers(p), [false, true, true, true, false, false], event);
	}
});

test("a merge group runs the push tiers, never the network-bound proofs, whatever it changes", () => {
	for (const files of [[], ["README.md"], ["packages/cli/src/index.ts"]]) {
		const p = plan({ event: "merge_group", files });
		assert.deepEqual(tiers(p), [false, true, true, true, false, false]);
		assert.equal(
			p.reason,
			"merge_group: the PR checks run; the release proofs run nightly",
		);
	}
});

test("when turbo cannot say what is affected, every tier runs", () => {
	const p = pr({
		files: ["packages/frontend/src/a.tsx"],
		affected: null,
	});
	assert.deepEqual(tiers(p), EVERYTHING);
	assert.equal(
		p.reason,
		"turbo could not list the affected packages: everything runs",
	);
});

test("a package whose files changed but that turbo did not list turns every tier on", () => {
	const p = pr({
		files: ["packages/frontend/src/a.tsx"],
		packages: PACKAGES,
		affected: ["@prismalens/desktop"],
	});
	assert.deepEqual(tiers(p), EVERYTHING);
	assert.equal(
		p.reason,
		"turbo did not list @prismalens/frontend, whose files changed: everything runs",
	);
});

test("a push whose tree already passed runs nothing and names the commit", () => {
	const p = pr({ files: ["packages/cli/src/a.ts"], sameTreeAs: "abc123" });
	assert.deepEqual(tiers(p), NOTHING);
	assert.match(p.reason, /abc123/);
});

test("a release PR and the full-ci label run every tier", () => {
	for (const over of [
		{ headRef: "release-please--branches--main" },
		{ labels: ["full-ci"] },
	]) {
		const p = pr({ files: ["packages/frontend/a.tsx"], ...over });
		assert.deepEqual(tiers(p), EVERYTHING);
	}
});

test("a draft release PR defers everything; the same PR ready, or a draft feature PR, does not", () => {
	const release = {
		headRef: "release-please--branches--main",
		files: ["package.json"],
	};
	const d = pr({ ...release, draft: true });
	assert.deepEqual(tiers(d), NOTHING);
	assert.equal(d.defer, true);
	const ready = pr({ ...release, draft: false });
	assert.deepEqual(
		[ready.skip, ready.defer, ready.full, ready.agents],
		[false, undefined, true, true],
	);
	const feature = pr({
		headRef: "feat/x",
		files: ["packages/api/src/a.ts"],
		packages: PACKAGES,
		affected: ["@prismalens/api"],
		draft: true,
	});
	assert.deepEqual([feature.skip, feature.defer], [false, undefined]);
});

test("marking a PR ready after its head passed CI runs nothing; without that pass it plans as usual", () => {
	const files = ["packages/api/src/a.ts"];
	const base = { files, packages: PACKAGES, affected: ["@prismalens/api"] };
	const passed = pr({ ...base, readyOnPassedHead: true });
	assert.deepEqual(tiers(passed), NOTHING);
	assert.match(passed.reason, /already passed CI/);
	assert.equal(pr({ ...base, readyOnPassedHead: false }).skip, false);
});

test("a PR with no listed files is not mistaken for docs-only and runs every tier", () => {
	assert.deepEqual(tiers(pr({ files: [] })), EVERYTHING);
});

test("every package a tier names is a workspace package, so a rename cannot switch a tier off", () => {
	const names = PACKAGES.map((p) => p.name);
	for (const [tier, named] of Object.entries(TIER_PACKAGES))
		for (const name of named)
			assert.ok(names.includes(name), `${tier} names ${name}`);
});

test("ci.yml and pr-title.yml, the two required workflows, run on merge_group", () => {
	for (const file of ["ci.yml", "pr-title.yml"]) {
		const on = parse(readFileSync(join(WORKFLOWS, file), "utf8")).on;
		assert.deepEqual(on.merge_group, { types: ["checks_requested"] }, file);
	}
});

test("the title check skips only its validation step on merge_group, so the one job still reports green", () => {
	const wf = parse(readFileSync(join(WORKFLOWS, "pr-title.yml"), "utf8"));
	const job = wf.jobs.validate;
	assert.equal(job.name, "Validate PR title (conventional commits)");
	assert.equal(job.if, undefined);
	assert.deepEqual(
		job.steps.map((/** @type {{ if?: string }} */ s) => s.if),
		["github.event_name != 'merge_group'"],
	);
});

test("the script tests run by discovery of every test file under scripts/, nested ones included", () => {
	const wf = parse(readFileSync(join(WORKFLOWS, "ci.yml"), "utf8"));
	const step = wf.jobs.lint.steps.find(
		(/** @type {{ name?: string }} */ s) => s.name === "Script tests",
	);
	assert.equal(
		step.run,
		"node --test --test-timeout=300000 'scripts/**/*.test.mjs'",
	);
	const found = globSync("scripts/**/*.test.mjs", { cwd: ROOT }).map((p) =>
		p.replaceAll("\\", "/"),
	);
	for (const file of [
		"scripts/ci-plan.test.mjs",
		"scripts/lib/upgrade-chain.test.mjs",
		"scripts/launcher/launcher.test.mjs",
	])
		assert.ok(found.includes(file), file);
});
