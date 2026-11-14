// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { Manifest, ManifestEntry, ManifestKind } from "./manifest.ts";
import {
	blocksIn,
	brief,
	conditionGrid,
	g1,
	g2,
	g3,
	g4Facts,
	g5,
	g6,
	judgePack,
	type KitInputs,
	matrix,
	profileConditions,
	renderBar,
	replaceBlocks,
	scoreCheck,
	simMissing,
	staleBlocks,
} from "./quality.ts";

const kind = (suffix: string): ManifestKind => ({
	file: "k.ts",
	suffix,
	about: "",
	refs: {},
	guards: [],
	aliases: [],
	keywords: [],
});
const said = { date: "2026-11-12", quote: "a slow link", where: "#1101" };
const cond = (id: string, fields: Record<string, unknown>): ManifestEntry => ({
	id,
	file: "c.conditions.ts",
	export: id,
	fields: {
		id,
		said,
		simulator: "net.throttle",
		appliesTo: { walks: ["attach"], categories: ["7"] },
		profile: { rttMs: 400 },
		measure: [{ metric: "firstContent", max: 3000, unit: "ms" }],
		ci: { debt: "climb" },
		status: "active",
		stage: { run: "node stage.mjs", live: "the attach thread" },
		...fields,
	} as ManifestEntry["fields"],
});

const base = (conditions: ManifestEntry[], extra: Partial<Manifest> = {}): Manifest => ({
	version: 1,
	kinds: { condition: kind(".conditions.ts"), lens: kind(".lenses.ts"), surface: kind(".surface.ts") },
	entries: {
		condition: conditions,
		lens: [],
		surface: ["chip", "header", "row"].map((id) => ({ id, file: "s.surface.ts", export: id, fields: { id } })),
	},
	gallery: [],
	uses: {},
	closed: {
		category: { file: "cat.ts", members: { "7": { title: "Chips", area: "Composer" }, "12": { title: "Network", area: "Transcript" } } },
		walk: {
			file: "walk.ts",
			members: {
				attach: { title: "Attach a file", categories: ["7"], surfaces: ["chip", "header"] },
				find: { title: "Find", categories: ["12"], surfaces: ["row"] },
			},
		},
		simulator: {
			file: "sim.ts",
			members: {
				"net.throttle": { title: "proxy", path: "p.mjs", run: "node p.mjs", status: "built", stamps: ["rttMs"], pathExists: true },
				"seed.x": { title: "seed", path: "s.mjs", run: "node s.mjs", status: "planned", stamps: [], pathExists: false },
				"fake.gone": { title: "gone", path: "g.mjs", run: "node g.mjs", status: "built", stamps: [], pathExists: false },
			},
		},
	},
	cases: [],
	climb: true,
	...extra,
});

describe("G1, the condition × surface matrix", () => {
	it("covers a cell by a case's walk, a case's surface tag, a live waiver or climb debt, and flags the rest", () => {
		const m = base(
			[
				cond("net.slow", { appliesTo: { walks: "all", categories: "all" }, ci: { case: "e2e/slow.spec.ts" } }),
				cond("huge.diff", { waivers: [{ surface: "chip", reason: "later", until: "2026-12-01" }], ci: { debt: "climb" } }),
				cond("old.waiver", { waivers: [{ surface: "chip", reason: "later", until: "2026-11-01" }] }),
			],
			{
				cases: [
					{ file: "e2e/slow.spec.ts", conditions: ["net.slow"], walks: ["attach"], surfaces: ["row"] },
				],
			},
		);
		expect(matrix(m, "2026-11-13").map((c) => `${c.condition}@${c.surface}:${c.state}`)).toEqual([
			"net.slow@chip:case",
			"net.slow@header:case",
			"net.slow@row:case",
			"huge.diff@chip:waiver",
			"huge.diff@header:debt",
			"old.waiver@chip:expired",
			"old.waiver@header:debt",
		]);
		expect(g1({ ...m, climb: false }, "2026-11-13")).toEqual([
			'condition "huge.diff" on surface "header" has no case: tag a test @cond:huge.diff with @walk:<a walk that visits it> or @surface:header, or add a waiver { surface, reason, until }',
			'condition "old.waiver"\'s waiver for "chip" has expired: cover it with a case or renew the waiver\'s until',
			'condition "old.waiver" on surface "header" has no case: tag a test @cond:old.waiver with @walk:<a walk that visits it> or @surface:header, or add a waiver { surface, reason, until }',
		]);
	});

	it("leaves a ci.case without the tag uncovered, and flags a walk that visits an unregistered surface", () => {
		const m = base([cond("net.slow", { ci: { case: "e2e/none.spec.ts" } })]);
		const walk = m.closed?.walk;
		const bad: Manifest = {
			...m,
			closed: { ...m.closed, walk: { file: "walk.ts", members: { ...walk?.members, odd: { title: "Odd", categories: [], surfaces: ["ghost"] } } } },
		};
		expect(g1(bad, "2026-11-13")).toEqual([
			'condition "net.slow" on surface "chip" has no case: tag a test @cond:net.slow with @walk:<a walk that visits it> or @surface:chip, or add a waiver { surface, reason, until }',
			'condition "net.slow" on surface "header" has no case: tag a test @cond:net.slow with @walk:<a walk that visits it> or @surface:header, or add a waiver { surface, reason, until }',
			'condition "net.slow" names ci.case e2e/none.spec.ts, which carries no @cond:net.slow tag',
			'walk "odd" visits surface "ghost", which is not registered',
		]);
	});
});

describe("G2, G3, G5 and G6", () => {
	it("G2: an active condition needs a built simulator that exists; a parked one may sit on a planned one", () => {
		const m = base([
			cond("a.planned", { simulator: "seed.x" }),
			cond("b.missing", { simulator: "fake.gone" }),
			cond("c.parked", { simulator: "seed.x", status: "parked" }),
			cond("d.unknown", { simulator: "nope" }),
		]);
		expect(g2(m)).toEqual([
			'condition "a.planned" is active on simulator "seed.x", which is planned: build it or set status: "parked"',
			'simulator "fake.gone" names g.mjs, which does not exist',
			'condition "d.unknown" names simulator "nope", which is not in the simulator set',
		]);
	});

	it("G3: a built simulator lists the fields its stamp records", () => {
		expect(g3(base([]))).toEqual([
			'simulator "fake.gone" lists no stamps: name the observed fields its stamp records',
		]);
	});

	it("G5: an entry says who asked, when and how; a lens names conditions or a check", () => {
		const m = base([cond("a.x", { said: { date: "Nov 12", quote: "", where: "" } })]);
		const withLens: Manifest = {
			...m,
			entries: {
				...m.entries,
				lens: [
					{ id: "eng.empty", file: "l.lenses.ts", export: "e", fields: { id: "eng.empty", said, conditions: [] } },
					{ id: "eng.check", file: "l.lenses.ts", export: "c", fields: { id: "eng.check", said, conditions: [], check: { script: "x" } } },
				],
			},
		};
		expect(g5(withLens, "condition")).toEqual([
			'condition "a.x" has no said.date (YYYY-MM-DD)',
			'condition "a.x" has no said.quote: paste the words that asked for it',
		]);
		expect(g5(withLens, "lens")).toEqual(['lens "eng.empty" names no condition and no check, so nothing applies it']);
	});

	it("G6: an active condition with no stage fails; a parked one may wait", () => {
		const m = base([cond("a.nostage", { stage: undefined }), cond("b.parked", { stage: undefined, status: "parked" })]);
		expect(g6(m)).toEqual(['condition "a.nostage" is active with no stage: pnpm sim cannot put the app into it']);
	});
});

describe("G4, the counts that may only fall", () => {
	it("counts debt cells, waivers, parked and uncased conditions, and cases naming no condition", () => {
		const m = base(
			[
				cond("a.debt", {}),
				cond("b.parked", { status: "parked" }),
				cond("c.waived", { waivers: [{ surface: "chip", reason: "r", until: "2026-12-01" }, { surface: "header", reason: "r", until: "2026-12-01" }] }),
			],
			{ cases: [{ file: "e2e/x.spec.ts", conditions: ["gone.id"], walks: [], surfaces: [] }] },
		);
		expect(Array.from(g4Facts(m, "2026-11-13"))).toEqual([
			["c.conditions.ts\tG4-debt", 2],
			["c.conditions.ts\tG4-waiver", 2],
			["c.conditions.ts\tG4-uncased", 2],
			["c.conditions.ts\tG4-parked", 1],
			["e2e/x.spec.ts\tG4-orphan-case", 1],
		]);
	});
});

describe("the bar render", () => {
	const m = base([cond("net.slow", {}), cond("b.parked", { status: "parked", appliesTo: { walks: "all", categories: ["12"] } })]);
	const blocks = renderBar(m, "2026-11-13");

	it("writes the condition table with status, simulator state and CI state", () => {
		expect(blocks.conditions).toBe(
			[
				"| Condition | Status | Categories | Walks | Simulator | CI | What is measured |",
				"| :-- | :-- | :-- | :-- | :-- | :-- | :-- |",
				"| net.slow | active | 7 | attach | net.throttle (built) | 0/2 cased, 2 CI debt | firstContent ≤ 3000 ms |",
				"| b.parked | parked | 12 | all | net.throttle (built) | parked | firstContent ≤ 3000 ms |",
			].join("\n"),
		);
		expect(blocks.categories?.split("\n")[2]).toBe("| 7 | Chips | Composer | attach | net.slow |");
	});

	it("replaces only the marker blocks and reports a body without them", () => {
		const body = "Intro\n<!-- registry:walks -->\nold\n<!-- /registry:walks -->\nOutro";
		const { body: next, problems } = replaceBlocks(body, { walks: "new", conditions: "c" });
		expect(next).toBe("Intro\n<!-- registry:walks -->\nnew\n<!-- /registry:walks -->\nOutro");
		expect(problems).toEqual([
			"the body has no <!-- registry:conditions --> … <!-- /registry:conditions --> markers: add them where the table goes",
		]);
		expect(blocksIn(next, ["walks", "conditions"])).toEqual({ walks: "new", conditions: undefined });
		expect(staleBlocks(next, { walks: "new", conditions: "c" })).toEqual(["conditions"]);
	});
});

describe("the judge pack", () => {
	const plain = base([cond("net.slow", { trigger: { run: "drop", on: "schedule", atS: 30 } })]);
	// A kit has every input: a reference per category, the rules and the false alarms.
	const m = {
		...plain,
		closed: {
			...plain.closed,
			category: {
				file: "cat.ts",
				members: {
					"7": { title: "Chips", area: "Composer", reference: "02-composer" },
					"12": { title: "Network", area: "Transcript", reference: "none" },
				},
			},
			judgeRule: { file: "judge.ts", members: { merge: { title: "Merge", text: "median" }, stop: { title: "Stop", text: "twice" } } },
			falseAlarm: { file: "judge.ts", members: { fixture: { text: "fixture text" } } },
		},
	} as Manifest;
	const kit: KitInputs = {
		referenceRoot: "screens",
		references: { "02-composer": ["a.png"] },
		calibration: { file: "calibration.json", text: '{"A": {"7": 8}}' },
		since: { file: "since.md", text: "- the rail" },
		evidence: null,
	};
	const slots = "{{references}}{{calibration}}{{since}}{{falseAlarms}}";

	it("fills the slot with where each condition is live, what fires it and the stamp owed", () => {
		const grid = conditionGrid(m, "cp4");
		expect(grid.split("\n")[4]).toBe(
			"| attach | net.slow | the attach thread | the sim, on schedule at 30 s | firstContent ≤ 3000 ms | stamps/cp4/attach__net.slow.json (rttMs) |",
		);
		const { files, problems } = judgePack(m, "cp4", [{ name: "judge.md", text: `Score.\n{{conditions}}\n${slots}` }], kit);
		expect(problems).toEqual([]);
		expect(files[0]?.text.slice(0, grid.length + 8)).toBe(`Score.\n${grid}\n`);
	});

	it("fills a {{walks}} slot with each walk's title, categories and active conditions", () => {
		const { files, problems } = judgePack(m, "cp4", [{ name: "judge.md", text: `{{walks}}\n{{conditions}}${slots}` }], kit);
		expect(problems).toEqual([]);
		expect(files[0]?.text.split("\n").slice(0, 4)).toEqual([
			"| Walk | Title | Categories | Conditions |",
			"| :-- | :-- | :-- | :-- |",
			"| attach | Attach a file | 7 | net.slow |",
			"| find | Find | 12 |  |",
		]);
	});

	it("refuses a template without the slot and one that names a condition outside it", () => {
		const { files, problems } = judgePack(
			m,
			"cp4",
			[
				{ name: "a.md", text: "no slot" },
				{ name: "b.md", text: `{{conditions}} and net.slow again${slots}` },
			],
			kit,
		);
		expect(files).toEqual([]);
		expect(problems).toEqual([
			"a.md has no {{conditions}}, {{references}}, {{calibration}}, {{since}}, {{falseAlarms}} slot: add each where the judge reads it",
			"b.md names net.slow outside the {{conditions}} slot: remove them; the slot carries every condition",
		]);
	});
});

describe("score-check", () => {
	const m = base([cond("net.slow", {}), cond("huge.diff", { appliesTo: { walks: ["find"], categories: ["12"] } })]);
	const stamped = new Set(["attach×net.slow"]);
	const check = (c: { walk: string; condition: { id: string } }) =>
		stamped.has(`${c.walk}×${c.condition.id}`) ? [] : ["no stamp"];

	it("nulls each category resting on a cell without a valid stamp, and keeps the rest", () => {
		expect(scoreCheck(m, { "7": 8, "12": 6, "18": 7, "3": null }, check)).toEqual({
			scores: { "7": 8, "12": null, "18": 7, "3": null },
			why: { "12": ["find × huge.diff: no stamp"] },
		});
	});

	it("fails a sim run that left an applied condition unstamped, and checks only the ones it applied", () => {
		expect(simMissing(m, check, ["net.slow"])).toEqual([]);
		expect(simMissing(m, check)).toEqual([
			'the sim run left condition "huge.diff" unstamped: its stage or simulator wrote no valid stamp',
		]);
	});
});

describe("brief", () => {
	it("lists the conditions and lenses on the surfaces, their simulators and the open debt", () => {
		const m = base([cond("net.slow", {})]);
		const withLens: Manifest = {
			...m,
			entries: {
				...m.entries,
				lens: [{ id: "eng.speed", file: "l.lenses.ts", export: "s", fields: { id: "eng.speed", conditions: ["net.slow"], rubric: "Fast on a slow link." } }],
			},
		};
		expect(brief(withLens, ["chip"], "2026-11-13")).toBe(
			[
				"Conditions and lenses in force on chip (from the registry; do not retype):",
				"- net.slow [active] via net.throttle (built: node p.mjs); measure: firstContent ≤ 3000 ms",
				"- lens eng.speed: Fast on a slow link.",
				"Open debt: net.slow@chip (debt).",
			].join("\n"),
		);
	});
});

describe("sim profiles", () => {
	const withProfiles = (m: Manifest): Manifest => ({
		...m,
		closed: {
			...m.closed,
			profile: {
				file: "profile.ts",
				members: {
					bare: { title: "none", select: "none" },
					ci: { title: "cased", select: "cased" },
					all: { title: "active", select: "active" },
					odd: { title: "odd", select: "some" },
				},
			},
		},
	});
	const m = withProfiles(
		base(
			[
				cond("net.slow", { trigger: { run: "drop", on: "schedule", atS: 30 } }),
				cond("huge.diff", {}),
				cond("b.parked", { status: "parked" }),
			],
			{ cases: [{ file: "e2e/slow.spec.ts", conditions: ["net.slow"], walks: ["attach"], surfaces: [] }] },
		),
	);
	const ids = (name: string) => profileConditions(m, name).conditions.map((c) => c.id);

	it("resolves bare to none, ci to the active conditions with a case, all to every active one, and an id to itself", () => {
		expect(ids("bare")).toEqual([]);
		expect(ids("ci")).toEqual(["net.slow"]);
		expect(ids("all")).toEqual(["net.slow", "huge.diff"]);
		expect(ids("b.parked")).toEqual(["b.parked"]);
	});

	// The thresholds ride along for `pnpm sim report` (scripts/sim/report.mjs).
	it("hands sim each condition's simulator, stage, trigger, measure, profile and walks", () => {
		expect(profileConditions(m, "net.slow").conditions).toEqual([
			{
				id: "net.slow",
				status: "active",
				simulator: { id: "net.throttle", title: "proxy", path: "p.mjs", run: "node p.mjs", status: "built", stamps: ["rttMs"], pathExists: true },
				stage: { run: "node stage.mjs", live: "the attach thread" },
				trigger: { run: "drop", on: "schedule", atS: 30 },
				measure: [{ metric: "firstContent", max: 3000, unit: "ms" }],
				profile: { rttMs: 400 },
				walks: ["attach"],
			},
		]);
	});

	it("names the profiles when asked for an unknown one, and rejects an unknown selector", () => {
		expect(profileConditions(m, "nope").problems).toEqual([
			'no profile or condition "nope": profiles are bare, ci, all, odd, or a condition id (pnpm registry ls condition)',
		]);
		expect(profileConditions(m, "odd").problems).toEqual([
			'profile "odd" selects "some": use none, cased or active',
		]);
	});
});
