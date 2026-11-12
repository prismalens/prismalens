// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { allActions, allSurfaces, duplicateIds } from "./registry";

/** Source text of the app, for the guards that read what the code renders. */
const SOURCES = import.meta.glob<string>(["../../**/*.tsx", "../../**/*.ts"], {
	query: "?raw",
	import: "default",
	eager: true,
});
const app = Object.entries(SOURCES).filter(
	([f]) => !/\.test\.tsx?$/.test(f) && !f.includes("/kit/registry"),
);
const design = app.filter(([f]) => f.startsWith("../../design/"));

/** Gallery ids: `data-kit-state` stages and section ids under `design/`. */
const galleryIds = new Set(
	design.flatMap(([, text]) =>
		[
			...Array.from(text.matchAll(/<Stage\s+id="([^"]+)"/g)),
			...Array.from(text.matchAll(/\bid: "([^"]+)",\s*title:/g)),
			...Array.from(text.matchAll(/data-kit-state="([^"]+)"/g)),
		].map((m) => m[1] as string),
	),
);

/**
 * Inventory surfaces this round has not registered yet (#1125). The list only
 * shrinks: registering one fails this test until it is removed here.
 */
const UNREACHED = [
	"thread.row",
	"thread.header",
	"message",
	"tool.row",
	"subagent.node",
	"child.card",
	"diff.file",
	"diff.line",
	"pr.chip",
	"check.row",
	"attachment.chip",
	"pane.tab",
	"browser.tab",
	"service.row",
	"incident.row",
	"alert.row",
	"settings.row",
	"schedule.row",
] as const;
const UNREACHED_MAX = 18;

/**
 * Files that still pass inline `entries` to the kit Menu or ContextMenu instead
 * of a registered surface. The list only shrinks.
 */
/** Paths as the glob keys them: kit files as `./`, the rest from `src` as `../../`. */
const INLINE_MENUS = [
	"./ListCard.tsx",
	"./Surface.tsx",
	"../../design/gallery.kit.tsx",
];

describe("the surface and action registry (#1125)", () => {
	it("has no id registered twice", () => {
		expect(duplicateIds()).toEqual([]);
	});

	it("gives every action a label and an icon", () => {
		const missing = allActions()
			.filter((a) => !a.label || !a.icon)
			.map((a) => a.id);
		expect(missing).toEqual([]);
	});

	it("reaches every action from some surface's menu, which the palette lists", () => {
		const placed = new Set(
			allSurfaces().flatMap((s) => [
				...(s.menus.context ?? []),
				...(s.menus.more ?? []),
			]),
		);
		const orphans = allActions()
			.map((a) => a.id)
			.filter((id) => !placed.has(id as never));
		expect(orphans).toEqual([]);
	});

	it("places only registered actions in a surface's menus", () => {
		const ids = new Set<string>(allActions().map((a) => a.id));
		const unknown = allSurfaces().flatMap((s) =>
			[...(s.menus.context ?? []), ...(s.menus.more ?? [])]
				.filter((a) => a !== "-" && !ids.has(a))
				.map((a) => `${s.id}: ${a}`),
		);
		expect(unknown).toEqual([]);
	});

	it("gives every surface a default and a phone state that the gallery draws", () => {
		const broken = allSurfaces().flatMap((s) =>
			Object.entries(s.states)
				.filter(([, g]) => !galleryIds.has(g))
				.map(([name, g]) => `${s.id}.${name} → ${g}`)
				.concat(
					["default", "phone"]
						.filter((n) => !(n in s.states))
						.map((n) => `${s.id}.${n} missing`),
				),
		);
		expect(broken).toEqual([]);
	});

	it("registers every surface the app renders", () => {
		const registered = new Set<string>(allSurfaces().map((s) => s.id));
		const rendered = app.flatMap(([f, text]) =>
			[
				...Array.from(text.matchAll(/<Surface(?:More)?\s+id="([^"]+)"/g)),
				...Array.from(text.matchAll(/data-surface="([^"]+)"/g)),
			]
				.map((m) => m[1] as string)
				.filter((id) => !registered.has(id))
				.map((id) => `${id} in ${f}`),
		);
		expect(rendered).toEqual([]);
	});

	it("lets a `when` read typed facts only, never a string comparison", () => {
		const stringy = app
			.filter(([f]) => /\.actions\.ts$/.test(f))
			.flatMap(([f, text]) =>
				Array.from(text.matchAll(/(?:when|disabled): \([^)]*\) =>[^\n]*/g))
					.map((m) => m[0])
					.filter((line) => /["'`]/.test(line))
					.map((line) => `${f}: ${line}`),
			);
		expect(stringy).toEqual([]);
	});

	it("shrinks the unreached-surface list: none of it is registered yet", () => {
		const registered = new Set<string>(allSurfaces().map((s) => s.id));
		expect(UNREACHED.filter((id) => registered.has(id))).toEqual([]);
		expect(UNREACHED.length).toBeLessThanOrEqual(UNREACHED_MAX);
	});

	it("shrinks the files that pass inline entries to a kit menu", () => {
		const inline = app
			.filter(([f, text]) => {
				if (f.endsWith("/kit/Menu.tsx")) return false;
				return /<(?:Menu|ContextMenu)\b[^>]*?\bentries=/.test(text);
			})
			.map(([f]) => f)
			.sort();
		expect(inline).toEqual([...INLINE_MENUS].sort());
	});
});
