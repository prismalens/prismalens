// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One fact, one place (#1101): reads the facts a design-matrix shot saw (`facts` in
 * matrix.json) against the registry's `fact` and `factPlace` closed sets. A fact about one
 * thread shown in N places counts N-1, less the pairs its entry declares on purpose.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {{ fact: string, about: string, place: string, text: string, near?: string }} ShownFact */
/** @typedef {{ fact: string, about: string, places: string[], texts: string[] }} Repeat */

/** The closed sets as the evidence reads them, from the manifest beside `frontend`. */
export function factRules(frontend) {
	const m = JSON.parse(
		readFileSync(join(frontend, "src/registry/registry.manifest.json"), "utf8"),
	);
	/** @type {Record<string, { label: string, home: string, repeats?: { places: [string, string], why: string }[] }>} */
	const facts = m.closed?.fact?.members ?? {};
	/** @type {Record<string, { title: string, facts: string[] }>} */
	const places = m.closed?.factPlace?.members ?? {};
	return { facts, places };
}

/** @param {ShownFact[]} shown @param {ReturnType<typeof factRules>} rules */
export function repeatsIn(shown, rules) {
	/** @type {Map<string, ShownFact[]>} */
	const by = new Map();
	for (const s of shown) {
		const k = `${s.fact}\t${s.about}`;
		by.set(k, [...(by.get(k) ?? []), s]);
	}
	/** @type {Repeat[]} */
	const repeats = [];
	let count = 0;
	for (const list of by.values()) {
		const places = [...new Set(list.map((s) => s.place))];
		if (places.length < 2) continue;
		// Declared pairs join their places into one group; each group past the first is a repeat.
		const group = new Map(places.map((p) => [p, p]));
		const root = (/** @type {string} */ p) => {
			let r = p;
			while (group.get(r) !== r) r = /** @type {string} */ (group.get(r));
			return r;
		};
		for (const d of rules.facts[list[0].fact]?.repeats ?? [])
			if (group.has(d.places[0]) && group.has(d.places[1]))
				group.set(root(d.places[0]), root(d.places[1]));
		const n = new Set(places.map(root)).size - 1;
		if (n < 1) continue;
		count += n;
		repeats.push({
			fact: list[0].fact,
			about: list[0].about,
			places,
			texts: [...new Set(list.map((s) => s.text).filter(Boolean))],
		});
	}
	const undeclared = [
		...new Set(
			shown
				.filter(
					(s) =>
						s.place !== "page" &&
						!(rules.places[s.place]?.facts ?? []).includes(s.fact),
				)
				.map((s) => `${s.place}: ${s.fact}`),
		),
	];
	const unplaced = [
		...new Set(
			shown
				.filter((s) => s.place === "page")
				.map((s) => `${s.fact}${s.near ? ` near ${s.near}` : ""}`),
		),
	];
	return { count, repeats, undeclared, unplaced };
}

/**
 * The ratchet's total: dark shots only (a theme shows the same facts), one desk width (1024 px
 * or wider) and the phone (under 640), so a design-matrix run and the evidence run compare.
 * @param {Record<string, { facts?: ShownFact[] }>} report
 */
export function factTotal(report, rules) {
	/** @type {Map<string, number>} */
	const per = new Map();
	for (const [key, m] of Object.entries(report)) {
		const at = /^(.*)-(\d{3,4})-dark$/.exec(key);
		if (!at || !m.facts) continue;
		const w = Number(at[2]);
		const cls = w >= 1024 ? "desk" : w < 640 ? "phone" : null;
		if (!cls) continue;
		const k = `${at[1]}\t${cls}`;
		per.set(k, Math.max(per.get(k) ?? 0, repeatsIn(m.facts, rules).count));
	}
	return [...per.values()].reduce((a, b) => a + b, 0);
}

/** The ratchet's row for the total, `measure/facts	repeated	<n>`; 0 when absent. */
export function factCeiling(ratchetTsv) {
	const line = ratchetTsv
		.split(/\r?\n/)
		.find((l) => l.startsWith("measure/facts\trepeated\t"));
	return line ? Number(line.split("\t")[2]) : 0;
}
