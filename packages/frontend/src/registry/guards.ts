// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	fieldAt,
	g1,
	g2,
	g3,
	g5,
	g6,
	guard,
	stringsIn,
} from "@prismalens/registry";

const today = () => new Date().toISOString().slice(0, 10);

/** G1: each active condition × each surface its walks visit is covered by a case, a live waiver or climb debt. */
export const matrix = guard(
	"matrix",
	'Tag a test @cond:<id> with @walk:<walk> or @surface:<id>, add a waiver { surface, reason, until }, or during the climb set ci: { debt: "climb" }.',
	(c) => g1(c.manifest, today()),
);

/** G2: an active condition runs on a built simulator that exists; a planned one keeps it parked. */
export const simulated = guard(
	"simulator",
	'Point it at a built simulator in registry/closed/simulator.ts, or set status: "parked" until one is built.',
	(c) => g2(c.manifest),
);

/** G3: every built simulator names the observed fields its stamp records. */
export const stamped = guard(
	"stamp",
	"List the observed fields in the simulator's stamps.",
	(c) => g3(c.manifest),
);

/** G6: an active condition stages itself, so judges get a built environment and never induce it by hand. */
export const staged = guard(
	"stage",
	"Give it stage: { run, live }: the command that puts the app into it (may use {url}) and where a judge finds it.",
	(c) => g6(c.manifest),
);

/** G5: every condition and lens says who asked, when and in what words; a lens names conditions or a check. */
export const provenance = guard(
	"provenance",
	"Fill said: { date, quote, where } with the words that asked for it; give a lens conditions or a check.",
	(c) => g5(c.manifest, c.kind === "lens" ? "lens" : "condition"),
);

/** Every live entry has a non-empty label (a string, or a function of its object). */
export const labelled = guard(
	"labelled",
	"Give it a label: the words a menu, a tooltip or search shows.",
	(c) =>
		Array.from(c.live(c.kind).values())
			.filter((e) => !(e as { label?: unknown }).label)
			.map((e) => `${c.kind} "${e.id}" has no label`),
);

/** Every action is placed in some surface's menu, so the palette and right-click reach it. */
export const reachable = guard(
	"reachable",
	"Place its id in a surface's `menus` (its *.surface.ts), or delete the action.",
	(c) => {
		const placed = new Set(
			(c.manifest.entries.surface ?? []).flatMap((s) => [
				...stringsIn(fieldAt(s.fields, "menus.context")),
				...stringsIn(fieldAt(s.fields, "menus.more")),
			]),
		);
		return c.entries
			.filter((e) => !placed.has(e.id))
			.map((e) => `action "${e.id}" is in no surface's menu`);
	},
);

/** Its `states` are literal, include `default` and `phone`, and each names a gallery id. */
export const galleryStates = guard(
	"gallery",
	'Write `states: { default: "<id>", phone: "<id>" }` with ids a design/gallery.*.tsx draws (`<Stage id>` or `data-kit-state`).',
	(c) => {
		const drawn = new Set(c.manifest.gallery);
		return c.entries.flatMap((e) => {
			const states = e.fields.states;
			if (!states || typeof states !== "object" || Array.isArray(states))
				return [`${c.kind} "${e.id}" has no literal states`];
			const s = states as Readonly<Record<string, unknown>>;
			return [
				...["default", "phone"]
					.filter((n) => !(n in s))
					.map((n) => `${c.kind} "${e.id}" has no ${n} state`),
				...Object.entries(s)
					.filter(([, g]) => typeof g !== "string" || !drawn.has(g))
					.map(
						([n, g]) =>
							`${c.kind} "${e.id}" state ${n} names "${String(g)}", which the gallery does not draw`,
					),
			];
		});
	},
);

/** Every id the app renders (`<Surface id>`, `data-surface`) is registered. */
export const rendered = guard(
	"rendered",
	"Declare it with `pnpm new surface <id>`, or render a registered id.",
	(c) => {
		const ids = new Set(c.entries.map((e) => e.id));
		return (c.manifest.uses[c.kind] ?? [])
			.filter((u) => !ids.has(u.id))
			.map(
				(u) =>
					`${c.kind} "${u.id}" is rendered in ${u.file} but not registered`,
			);
	},
);
