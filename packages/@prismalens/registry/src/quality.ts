// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Literal, Manifest, ManifestEntry } from "./manifest.ts";

/**
 * The quality registry over the manifest: conditions (atomic, simulated states
 * with a measure), lenses (holistic angles that group conditions or name a
 * check), and the closed simulator, category and walk sets (#1101). Everything
 * here reads the manifest only, so the guards, the ratchet and the CLI agree.
 */

type Fields = ManifestEntry["fields"];
const obj = (v: Literal | undefined): Readonly<Record<string, Literal>> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, Literal>)
		: {};
const strs = (v: Literal | undefined): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: Literal | undefined) => (typeof v === "string" ? v : undefined);

export interface Condition {
	readonly id: string;
	readonly file: string;
	readonly status: string;
	readonly simulator: string;
	readonly walks: readonly string[];
	readonly categories: readonly string[];
	readonly surfaces: readonly string[];
	readonly profile: Readonly<Record<string, Literal>>;
	readonly measure: readonly Literal[];
	readonly verdict: string;
	readonly debt: boolean;
	readonly ciCase?: string;
	readonly waivers: readonly {
		surface: string;
		reason: string;
		until: string;
	}[];
	readonly fields: Fields;
}

const members = (m: Manifest, set: string) => m.closed?.[set]?.members ?? {};

/** Each condition entry with its walks, categories and surfaces resolved ("all" expanded). */
export function conditions(m: Manifest): Condition[] {
	const walks = members(m, "walk");
	const cats = Object.keys(members(m, "category"));
	return (m.entries.condition ?? []).map((e) => {
		const applies = obj(e.fields.appliesTo);
		const w =
			applies.walks === "all" ? Object.keys(walks) : strs(applies.walks);
		const ci = obj(e.fields.ci);
		return {
			id: e.id,
			file: e.file,
			status: str(e.fields.status) ?? "parked",
			simulator: str(e.fields.simulator) ?? "",
			walks: w,
			categories:
				applies.categories === "all" ? cats : strs(applies.categories),
			surfaces: Array.from(
				new Set(w.flatMap((id) => strs(walks[id]?.surfaces))),
			).sort(),
			profile: obj(e.fields.profile),
			measure: Array.isArray(e.fields.measure) ? e.fields.measure : [],
			verdict: str(e.fields.verdict) ?? "reviewed",
			debt: ci.debt === "climb",
			...(str(ci.case) ? { ciCase: str(ci.case) } : {}),
			waivers: (Array.isArray(e.fields.waivers) ? e.fields.waivers : []).map(
				(x) => {
					const o = obj(x);
					return {
						surface: str(o.surface) ?? "",
						reason: str(o.reason) ?? "",
						until: str(o.until) ?? "",
					};
				},
			),
			fields: e.fields,
		};
	});
}

export interface Cell {
	readonly condition: string;
	readonly surface: string;
	readonly state: "case" | "waiver" | "debt" | "missing" | "expired";
}

/** G1's grid: each active condition × each surface its walks visit, and what covers it. */
export function matrix(m: Manifest, today: string): Cell[] {
	const walks = members(m, "walk");
	const cases = m.cases ?? [];
	return conditions(m)
		.filter((c) => c.status === "active")
		.flatMap((c) =>
			c.surfaces.map((surface): Cell => {
				const cased = cases.some(
					(k) =>
						k.conditions.includes(c.id) &&
						(k.surfaces.includes(surface) ||
							k.walks.some((w) => strs(walks[w]?.surfaces).includes(surface))),
				);
				if (cased) return { condition: c.id, surface, state: "case" };
				const waiver = c.waivers.find((w) => w.surface === surface);
				if (waiver)
					return {
						condition: c.id,
						surface,
						state: waiver.until >= today ? "waiver" : "expired",
					};
				if (c.debt && m.climb)
					return { condition: c.id, surface, state: "debt" };
				return { condition: c.id, surface, state: "missing" };
			}),
		);
}

/** G1: every active cell is covered by a case, a live waiver, or climb debt. */
export function g1(m: Manifest, today: string): string[] {
	const out = matrix(m, today).flatMap((cell) =>
		cell.state === "missing"
			? [
					`condition "${cell.condition}" on surface "${cell.surface}" has no case: tag a test @cond:${cell.condition} with @walk:<a walk that visits it> or @surface:${cell.surface}, or add a waiver { surface, reason, until }`,
				]
			: cell.state === "expired"
				? [
						`condition "${cell.condition}"'s waiver for "${cell.surface}" has expired: cover it with a case or renew the waiver's until`,
					]
				: [],
	);
	const cases = m.cases ?? [];
	for (const c of conditions(m))
		if (
			c.ciCase &&
			!cases.some((k) => k.file === c.ciCase && k.conditions.includes(c.id))
		)
			out.push(
				`condition "${c.id}" names ci.case ${c.ciCase}, which carries no @cond:${c.id} tag`,
			);
	const surfaces = new Set((m.entries.surface ?? []).map((e) => e.id));
	for (const [id, w] of Object.entries(members(m, "walk")))
		for (const s of strs(w.surfaces))
			if (!surfaces.has(s))
				out.push(`walk "${id}" visits surface "${s}", which is not registered`);
	return out;
}

/** G2: an active condition runs on a built simulator whose path exists; a planned one forces parked. */
export function g2(m: Manifest): string[] {
	const sims = members(m, "simulator");
	const out: string[] = [];
	for (const c of conditions(m)) {
		const s = sims[c.simulator];
		if (!s) {
			out.push(
				`condition "${c.id}" names simulator "${c.simulator}", which is not in the simulator set`,
			);
			continue;
		}
		if (c.status !== "active") continue;
		if (s.status !== "built")
			out.push(
				`condition "${c.id}" is active on simulator "${c.simulator}", which is ${String(s.status)}: build it or set status: "parked"`,
			);
		else if (s.pathExists !== true)
			out.push(
				`simulator "${c.simulator}" names ${String(s.path)}, which does not exist`,
			);
	}
	return out;
}

/** G3 (static half): every built simulator says which observed fields its stamp records. */
export function g3(m: Manifest): string[] {
	return Object.entries(members(m, "simulator"))
		.filter(([, s]) => s.status === "built" && strs(s.stamps).length === 0)
		.map(
			([id]) =>
				`simulator "${id}" lists no stamps: name the observed fields its stamp records`,
		);
}

/** G6: an active condition has a stage, so `pnpm sim` can put the app into it (#1101). */
export function g6(m: Manifest): string[] {
	return conditions(m)
		.filter((c) => c.status === "active" && !obj(c.fields.stage).run)
		.map(
			(c) =>
				`condition "${c.id}" is active with no stage: pnpm sim cannot put the app into it`,
		);
}

/**
 * A sim run must stamp every condition it applied: each one with no valid stamp
 * in any of its walks fails the run, rather than nulling a score.
 */
export function simMissing(
	m: Manifest,
	check: (cell: {
		walk: string;
		condition: Condition;
		simulator: Readonly<Record<string, Literal>>;
	}) => string[],
	applied?: readonly string[],
): string[] {
	const sims = members(m, "simulator");
	return conditions(m)
		.filter((c) => (applied ? applied.includes(c.id) : c.status === "active"))
		.filter(
			(c) =>
				!c.walks.some(
					(walk) =>
						check({ walk, condition: c, simulator: sims[c.simulator] ?? {} })
							.length === 0,
				),
		)
		.map(
			(c) =>
				`the sim run left condition "${c.id}" unstamped: its stage or simulator wrote no valid stamp`,
		);
}

/** What `pnpm sim` needs to apply one condition: its simulator, stage, trigger and profile. */
export interface SimCondition {
	readonly id: string;
	readonly status: string;
	readonly simulator: { readonly id: string } & Readonly<
		Record<string, Literal>
	>;
	readonly stage?: Readonly<Record<string, Literal>>;
	readonly trigger?: Readonly<Record<string, Literal>>;
	readonly probe?: Readonly<Record<string, Literal>>;
	/** The thresholds a report holds the condition's stamps to. */
	readonly measure: readonly Literal[];
	readonly profile: Readonly<Record<string, Literal>>;
	readonly walks: readonly string[];
}

/** The seeds a profile writes after its stages; a single condition id has none. */
export function profileSeeds(m: Manifest, name: string): Literal[] {
	const seeds = members(m, "profile")[name]?.seeds;
	return Array.isArray(seeds) ? seeds : [];
}

/**
 * Resolves a profile name to the conditions it applies: a member of the closed
 * profile set (bare, ci, all) or a single condition id.
 */
export function profileConditions(
	m: Manifest,
	name: string,
): { conditions: SimCondition[]; problems: string[] } {
	const all = conditions(m);
	const profile = members(m, "profile")[name];
	const cased = new Set((m.cases ?? []).flatMap((k) => k.conditions));
	let picked: Condition[];
	if (profile) {
		const select = str(profile.select);
		if (select === "none") picked = [];
		else if (select === "cased")
			picked = all.filter((c) => c.status === "active" && cased.has(c.id));
		else if (select === "active")
			picked = all.filter((c) => c.status === "active");
		else
			return {
				conditions: [],
				problems: [
					`profile "${name}" selects "${String(profile.select)}": use none, cased or active`,
				],
			};
	} else {
		const one = all.find((c) => c.id === name);
		if (!one)
			return {
				conditions: [],
				problems: [
					`no profile or condition "${name}": profiles are ${Object.keys(members(m, "profile")).join(", ")}, or a condition id (pnpm registry ls condition)`,
				],
			};
		picked = [one];
	}
	const sims = members(m, "simulator");
	return {
		conditions: picked.map((c) => ({
			id: c.id,
			status: c.status,
			simulator: { id: c.simulator, ...(sims[c.simulator] ?? {}) },
			...(c.fields.stage ? { stage: obj(c.fields.stage) } : {}),
			...(c.fields.trigger ? { trigger: obj(c.fields.trigger) } : {}),
			...(c.fields.probe ? { probe: obj(c.fields.probe) } : {}),
			measure: Array.isArray(c.fields.measure) ? c.fields.measure : [],
			profile: c.profile,
			walks: c.walks,
		})),
		problems: [],
	};
}

/** G5: every condition and lens says who asked for it, when and in what words; a lens names conditions or a check. */
export function g5(m: Manifest, kind: "condition" | "lens"): string[] {
	const out: string[] = [];
	for (const e of m.entries[kind] ?? []) {
		const said = obj(e.fields.said);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(str(said.date) ?? ""))
			out.push(`${kind} "${e.id}" has no said.date (YYYY-MM-DD)`);
		if (!str(said.quote))
			out.push(
				`${kind} "${e.id}" has no said.quote: paste the words that asked for it`,
			);
		if (kind === "lens" && !strs(e.fields.conditions).length && !e.fields.check)
			out.push(
				`lens "${e.id}" names no condition and no check, so nothing applies it`,
			);
	}
	return out;
}

/** G4: the counts that may only fall, as ratchet facts keyed `file<TAB>rule`. */
export function g4Facts(m: Manifest, today: string): Map<string, number> {
	const facts = new Map<string, number>();
	const bump = (file: string, rule: string) => {
		const k = `${file}\t${rule}`;
		facts.set(k, (facts.get(k) ?? 0) + 1);
	};
	const all = conditions(m);
	const fileOf = new Map(all.map((c) => [c.id, c.file]));
	for (const cell of matrix(m, today)) {
		const file = fileOf.get(cell.condition) ?? "";
		if (cell.state === "debt") bump(file, "G4-debt");
		if (cell.state === "waiver") bump(file, "G4-waiver");
	}
	const cased = new Set((m.cases ?? []).flatMap((k) => k.conditions));
	for (const c of all) {
		if (c.status === "parked") bump(c.file, "G4-parked");
		if (c.status === "active" && !cased.has(c.id)) bump(c.file, "G4-uncased");
	}
	const ids = new Set(all.map((c) => c.id));
	for (const k of m.cases ?? [])
		for (const id of k.conditions)
			if (!ids.has(id)) bump(k.file, "G4-orphan-case");
	return facts;
}

const cell = (v: Literal | undefined): string =>
	v === undefined || v === null
		? ""
		: typeof v === "object"
			? JSON.stringify(v).replace(/\|/g, "\\|")
			: String(v).replace(/\|/g, "\\|");

const measureText = (ms: readonly Literal[]) =>
	ms
		.map((x) => {
			const o = obj(x);
			if (o.metric) {
				const unit = o.unit ? ` ${o.unit}` : "";
				const pages = (Array.isArray(o.pages) ? o.pages : [])
					.map((p) => obj(p))
					.map((p) => `${p.page} ≤ ${p.max}${unit}`);
				return `${o.metric} ≤ ${o.max}${unit}${pages.length ? ` (${pages.join(", ")})` : ""}`;
			}
			return str(o.state) ?? cell(x);
		})
		.join("; ");

/** The #1101 tables, each between `<!-- registry:<name> -->` markers. */
export function renderBar(m: Manifest, today: string): Record<string, string> {
	const cats = members(m, "category");
	const walks = members(m, "walk");
	const conds = conditions(m);
	const state = new Map<string, Cell["state"][]>();
	for (const c of matrix(m, today))
		state.set(c.condition, [...(state.get(c.condition) ?? []), c.state]);
	const walksOf = (cat: string) =>
		Object.entries(walks)
			.filter(([, w]) => strs(w.categories).includes(cat))
			.map(([id]) => id);
	const ci = (c: Condition) => {
		if (c.status !== "active") return "parked";
		const s = state.get(c.id) ?? [];
		const n = (k: Cell["state"]) => s.filter((x) => x === k).length;
		return [
			`${n("case")}/${s.length} cased`,
			n("debt") && `${n("debt")} CI debt`,
			n("waiver") && `${n("waiver")} waived`,
			n("missing") && `${n("missing")} missing`,
		]
			.filter(Boolean)
			.join(", ");
	};
	const table = (head: string[], rows: string[][]) =>
		[
			`| ${head.join(" | ")} |`,
			`| ${head.map(() => ":--").join(" | ")} |`,
			...rows.map((r) => `| ${r.join(" | ")} |`),
		].join("\n");
	return {
		categories: table(
			["#", "Category", "Area", "Walks", "Conditions"],
			Object.entries(cats).map(([id, c]) => [
				id,
				cell(c.title),
				cell(c.area),
				walksOf(id).join(", "),
				conds
					.filter((x) => x.categories.includes(id))
					.map((x) => x.id)
					.join(", "),
			]),
		),
		walks: table(
			["Walk", "Title", "Categories", "Surfaces"],
			Object.entries(walks).map(([id, w]) => [
				id,
				cell(w.title),
				strs(w.categories).join(", "),
				strs(w.surfaces).join(", "),
			]),
		),
		conditions: table(
			[
				"Condition",
				"Status",
				"Categories",
				"Walks",
				"Simulator",
				"CI",
				"What is measured",
			],
			conds.map((c) => {
				const sim = members(m, "simulator")[c.simulator];
				return [
					c.id,
					c.status,
					c.categories.join(", "),
					obj(c.fields.appliesTo).walks === "all" ? "all" : c.walks.join(", "),
					`${c.simulator}${sim ? ` (${String(sim.status)})` : ""}`,
					ci(c),
					measureText(c.measure),
				];
			}),
		),
	};
}

const marker = (name: string) =>
	[`<!-- registry:${name} -->`, `<!-- /registry:${name} -->`] as const;

/** The rendered blocks as they sit in a body, by name; absent when a body has no markers for it. */
export function blocksIn(
	body: string,
	names: readonly string[],
): Record<string, string | undefined> {
	return Object.fromEntries(
		names.map((n) => {
			const [open, close] = marker(n);
			const a = body.indexOf(open);
			const b = body.indexOf(close);
			return [
				n,
				a >= 0 && b > a ? body.slice(a + open.length, b).trim() : undefined,
			];
		}),
	);
}

/** Replaces each block between its markers; a body missing a block's markers is a problem. */
export function replaceBlocks(
	body: string,
	blocks: Record<string, string>,
): { body: string; problems: string[] } {
	let out = body.replace(/\r\n/g, "\n");
	const problems: string[] = [];
	for (const [n, text] of Object.entries(blocks)) {
		const [open, close] = marker(n);
		const a = out.indexOf(open);
		const b = out.indexOf(close);
		if (a < 0 || b < a) {
			problems.push(
				`the body has no ${open} … ${close} markers: add them where the table goes`,
			);
			continue;
		}
		out = `${out.slice(0, a + open.length)}\n${text}\n${out.slice(b)}`;
	}
	return { body: out, problems };
}

/** Which rendered blocks differ from the body's. */
export function staleBlocks(
	body: string,
	rendered: Record<string, string>,
): string[] {
	const now = blocksIn(body.replace(/\r\n/g, "\n"), Object.keys(rendered));
	return Object.entries(rendered)
		.filter(([n, text]) => now[n] !== text.trim())
		.map(([n]) => n);
}

/** The walk × condition grid a judge works through: the command to induce each cell and the stamp it owes. */
export function conditionGrid(m: Manifest, cp: string): string {
	const sims = members(m, "simulator");
	const walks = members(m, "walk");
	const conds = conditions(m);
	const rows = conds
		.filter((c) => c.status === "active")
		.flatMap((c) =>
			c.walks.map((w) => {
				const s = sims[c.simulator];
				const stage = obj(c.fields.stage);
				const trigger = obj(c.fields.trigger);
				const fires = trigger.run
					? `${trigger.on === "button" ? "the sim sheet's button" : "the sim, on schedule"}${trigger.atS !== undefined ? ` at ${String(trigger.atS)} s` : ""}`
					: "";
				return `| ${w} | ${c.id} | ${cell(stage.live)} | ${fires} | ${measureText(c.measure)} | stamps/${cp}/${w}__${c.id}.json (${strs(s?.stamps).join(", ")}) |`;
			}),
		);
	const parked = conds.filter((c) => c.status !== "active").map((c) => c.id);
	return [
		`The sim run has already put the app into every condition below; never start a simulator, seed or proxy yourself. A cell with no valid stamp is "not tested": score its categories null, never 0–10.`,
		"",
		"| Walk | Condition | Where it is live | Fired by | Measure | Stamp owed |",
		"| :-- | :-- | :-- | :-- | :-- | :-- |",
		...rows,
		"",
		parked.length
			? `Parked, not judged this checkpoint: ${parked.join(", ")}.`
			: "No parked conditions.",
		`Walks: ${Object.keys(walks).join(", ")}.`,
	].join("\n");
}

/** The walks a judge runs: each with its title, the categories it scores and the active conditions it runs under. */
export function walkTable(m: Manifest): string {
	const active = conditions(m).filter((c) => c.status === "active");
	return [
		"| Walk | Title | Categories | Conditions |",
		"| :-- | :-- | :-- | :-- |",
		...Object.entries(members(m, "walk")).map(
			([id, w]) =>
				`| ${id} | ${cell(w.title)} | ${strs(w.categories).join(", ")} | ${active
					.filter((c) => c.walks.includes(id))
					.map((c) => c.id)
					.join(", ")} |`,
		),
	].join("\n");
}

export const SLOT = "{{conditions}}";
/** Optional: a template that carries it gets the walk table there. */
export const WALKS_SLOT = "{{walks}}";
/** Every judge template carries these; `judge-pack` refuses one that lacks any (#1101 Scores). */
export const KIT_SLOTS = {
	references: "{{references}}",
	calibration: "{{calibration}}",
	since: "{{since}}",
	falseAlarms: "{{falseAlarms}}",
} as const;
/** Optional: the shared evidence folder (`pnpm sim judge-evidence`). */
export const EVIDENCE_SLOT = "{{evidence}}";
/** Optional, for the organizer's sheet: the merge and stop rules. Judges are not told the target. */
export const RULES_SLOT = "{{rules}}";

/** What a checkpoint's kit is filled from besides the registry; the CLI reads them from disk. */
export interface KitInputs {
	/** The reference root, and each folder in it with the screenshots it holds. */
	readonly referenceRoot: string;
	readonly references: Readonly<Record<string, readonly string[]>>;
	/** The calibration run's anchors file. */
	readonly calibration: { readonly file: string; readonly text: string } | null;
	/** What changed since the last scoring, one "- " line each. */
	readonly since: { readonly file: string; readonly text: string } | null;
	/** `pnpm sim judge-evidence`'s folder: its measures file and comparison images. */
	readonly evidence: {
		readonly dir: string;
		readonly measures: boolean;
		readonly compare: readonly string[];
	} | null;
}

/** A calibration file holds scores: JSON with a number in it, or Markdown with a scored table row. */
function calibrated(file: string, text: string): boolean {
	if (file.endsWith(".json")) {
		const nums = (v: unknown): boolean =>
			typeof v === "number" ||
			(!!v && typeof v === "object" && Object.values(v).some(nums));
		try {
			return nums(JSON.parse(text));
		} catch {
			return false;
		}
	}
	// A scored row names its reference (A, B, C) beside a score; a prompt's folder table does not.
	return text
		.split("\n")
		.some(
			(l) =>
				/^\|.*\|\s*(reference )?[ABC]\s*\|/i.test(l) &&
				/\|\s*\d+(\.5)?\s*\|/.test(l),
		);
}

/** Why a kit cannot go to judges; empty when every input is there. */
export function kitProblems(m: Manifest, inputs: KitInputs): string[] {
	const out: string[] = [];
	for (const [id, c] of Object.entries(members(m, "category"))) {
		const ref = str(c.reference);
		if (!ref)
			out.push(
				`category ${id} names no reference: set reference to a survey folder or "none"`,
			);
		else if (ref !== "none" && !inputs.references[ref]?.length)
			out.push(
				`category ${id}'s reference folder ${ref} holds no screenshots under ${inputs.referenceRoot}: add them or set reference: "none"`,
			);
	}
	if (!inputs.calibration)
		out.push(
			"no calibration anchors: pass --calibration <the calibration run's calibration.md or .json>",
		);
	else if (!calibrated(inputs.calibration.file, inputs.calibration.text))
		out.push(
			`${inputs.calibration.file} holds no scores: pass the file the calibration run wrote, not its prompt`,
		);
	const rules = members(m, "judgeRule");
	for (const r of ["merge", "stop"])
		if (!str(rules[r]?.text))
			out.push(`the registry has no ${r} rule: add it to the judgeRule set`);
	if (!inputs.since)
		out.push(
			"no since-last-scoring list: pass --since <file> with one '- ' line per change",
		);
	else if (!/^\s*[-*] \S/m.test(inputs.since.text))
		out.push(`${inputs.since.file} lists nothing: one '- ' line per change`);
	if (!Object.keys(members(m, "falseAlarm")).length)
		out.push("the registry lists no known false alarms: add a falseAlarm");
	if (inputs.evidence && !inputs.evidence.measures)
		out.push(
			`${inputs.evidence.dir} has no measures.md: run pnpm sim judge-evidence`,
		);
	return out;
}

/** Each category's reference folder and how many shots it holds, for the judge to open. */
function referenceTable(m: Manifest, inputs: KitInputs): string {
	return [
		`Reference screens are under ${inputs.referenceRoot}, one folder per surface. Never write a product name: call them reference A, B, C by file name.`,
		"",
		"| # | Category | Reference folder | Screenshots |",
		"| :-- | :-- | :-- | :-- |",
		...Object.entries(members(m, "category")).map(([id, c]) => {
			const ref = str(c.reference) ?? "none";
			const n = inputs.references[ref]?.length ?? 0;
			return `| ${id} | ${cell(c.title)} | ${ref === "none" ? 'none: write "no reference"' : ref} | ${n} |`;
		}),
	].join("\n");
}

const bullets = (
	set: Readonly<Record<string, Readonly<Record<string, Literal>>>>,
	head: (id: string, v: Readonly<Record<string, Literal>>) => string,
) =>
	Object.entries(set)
		.map(([id, v]) => `- **${head(id, v)}** ${cell(v.text)}`)
		.join("\n");

function evidenceText(e: NonNullable<KitInputs["evidence"]>): string {
	const sep = e.dir.includes("\\") ? "\\" : "/";
	return [
		"Read these before you open the app; then walk only the interactions. Never estimate contrast from pixels: use measures.md.",
		`- Shots at native resolution, 1440 and 390, through the slow link with the CPU slowed 4×: ${e.dir}${sep}shots (names carry screen-width-theme)`,
		`- Measures (axe contrast, targets under 24 px, clipping, sideways scroll, console errors, first content, longest task) and the notification log: ${e.dir}${sep}measures.md`,
		`- One comparison image per category, references on the left, PrismaLens on the right: ${e.compare.length ? e.compare.map((f) => `${e.dir}${sep}compare${sep}${f}`).join(", ") : "none written"}`,
	].join("\n");
}

/** The organizer's kit.md: the rules and every input the prompts were filled from. */
export function kitSheet(
	m: Manifest,
	cp: string,
	inputs: KitInputs,
	notes: readonly string[],
): string {
	return [
		`# Checkpoint ${cp} judge kit`,
		"",
		"## Rules",
		bullets(members(m, "judgeRule"), (_, v) => `${cell(v.title)}.`),
		"",
		"## Inputs",
		...notes,
		"",
		"## Since the last scoring",
		inputs.since?.text.trim() ?? "",
		"",
		"## Known false alarms (in every prompt)",
		bullets(members(m, "falseAlarm"), (id) => `${id}:`),
		"",
		"## References",
		referenceTable(m, inputs),
		"",
	].join("\n");
}

/**
 * Fills each judge template's slots: `{{conditions}}`, the kit slots, and `{{walks}}`,
 * `{{evidence}}` and `{{rules}}` when present. Refuses a kit missing an input, a template
 * missing a required slot, or one naming a condition outside its slot.
 */
export function judgePack(
	m: Manifest,
	cp: string,
	templates: readonly { name: string; text: string }[],
	inputs: KitInputs,
): { files: { name: string; text: string }[]; problems: string[] } {
	const ids = conditions(m).map((c) => c.id);
	const problems = kitProblems(m, inputs);
	const fill: Record<string, string> = {
		[SLOT]: conditionGrid(m, cp),
		[WALKS_SLOT]: walkTable(m),
		[KIT_SLOTS.references]: referenceTable(m, inputs),
		[KIT_SLOTS.calibration]: inputs.calibration
			? `Anchors from the calibration run (${inputs.calibration.file}); score PrismaLens on the same scale:\n\n${inputs.calibration.text.trim()}`
			: "",
		[KIT_SLOTS.since]: inputs.since?.text.trim() ?? "",
		[KIT_SLOTS.falseAlarms]: bullets(
			members(m, "falseAlarm"),
			(id) => `${id}:`,
		),
		[EVIDENCE_SLOT]: inputs.evidence ? evidenceText(inputs.evidence) : "",
		[RULES_SLOT]: bullets(
			members(m, "judgeRule"),
			(_, v) => `${cell(v.title)}.`,
		),
	};
	const files = templates.flatMap((t) => {
		const missing = [SLOT, ...Object.values(KIT_SLOTS)].filter(
			(slot) => !t.text.includes(slot),
		);
		if (missing.length) {
			problems.push(
				`${t.name} has no ${missing.join(", ")} slot: add each where the judge reads it`,
			);
			return [];
		}
		if (t.text.includes(EVIDENCE_SLOT) && !inputs.evidence) {
			problems.push(
				`${t.name} carries ${EVIDENCE_SLOT}: pass --evidence <pnpm sim judge-evidence's folder>`,
			);
			return [];
		}
		const named = ids.filter((id) => t.text.includes(id));
		if (named.length) {
			problems.push(
				`${t.name} names ${named.join(", ")} outside the ${SLOT} slot: remove them; the slot carries every condition`,
			);
			return [];
		}
		let text = t.text;
		for (const [slot, value] of Object.entries(fill))
			text = text.split(slot).join(value);
		return [{ name: t.name, text }];
	});
	return { files: problems.length ? [] : files, problems };
}

/** A category's score is null when any (walk, condition) cell mapped to it lacks a valid stamp. */
export function scoreCheck(
	m: Manifest,
	scores: Readonly<Record<string, number | null>>,
	check: (cell: {
		walk: string;
		condition: Condition;
		simulator: Readonly<Record<string, Literal>>;
	}) => string[],
): { scores: Record<string, number | null>; why: Record<string, string[]> } {
	const sims = members(m, "simulator");
	const active = conditions(m).filter((c) => c.status === "active");
	const out: Record<string, number | null> = { ...scores };
	const why: Record<string, string[]> = {};
	for (const [cat, score] of Object.entries(scores)) {
		if (score === null) continue;
		const reasons = active
			.filter((c) => c.categories.includes(cat))
			.flatMap((c) =>
				c.walks.flatMap((walk) =>
					check({ walk, condition: c, simulator: sims[c.simulator] ?? {} }).map(
						(p) => `${walk} × ${c.id}: ${p}`,
					),
				),
			);
		if (reasons.length) {
			out[cat] = null;
			why[cat] = reasons;
		}
	}
	return { scores: out, why };
}

/** The block a lane brief carries for its surfaces: conditions, lenses, simulators, measures and open debt. */
export function brief(
	m: Manifest,
	surfaces: readonly string[],
	today: string,
): string {
	const sims = members(m, "simulator");
	const conds = conditions(m).filter((c) =>
		c.surfaces.some((s) => surfaces.includes(s)),
	);
	const ids = new Set(conds.map((c) => c.id));
	const lenses = (m.entries.lens ?? []).filter(
		(l) =>
			strs(l.fields.conditions).some((c) => ids.has(c)) ||
			(!strs(l.fields.conditions).length && l.fields.check),
	);
	const open = matrix(m, today).filter(
		(c) => surfaces.includes(c.surface) && c.state !== "case",
	);
	const lines = [
		`Conditions and lenses in force on ${surfaces.join(", ")} (from the registry; do not retype):`,
		...(conds.length
			? conds.map((c) => {
					const s = sims[c.simulator];
					return `- ${c.id} [${c.status}] via ${c.simulator}${s ? ` (${String(s.status)}: ${String(s.run)})` : ""}; measure: ${measureText(c.measure) || "judged"}`;
				})
			: ["- no condition applies to these surfaces"]),
		...lenses.map((l) => `- lens ${l.id}: ${str(l.fields.rubric) ?? ""}`),
		open.length
			? `Open debt: ${open.map((c) => `${c.condition}@${c.surface} (${c.state})`).join(", ")}.`
			: "Open debt: none.",
	];
	return lines.join("\n");
}
