// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import type {
	ActionCtx,
	ActionDef,
	ActionFacts,
	ActionId,
	Facts,
	SurfaceCtx,
	SurfaceDef,
	SurfaceId,
} from "./actions";
import type { MenuEntry } from "./Menu";

type Def = ActionDef | SurfaceDef;
const isDef = (v: unknown): v is Def =>
	typeof v === "object" &&
	v !== null &&
	((v as Def).kind === "action" || (v as Def).kind === "surface");

/** Every export of every `*.actions.ts` and `*.surface.ts`: adding a file adds it. */
export function collect(modules: Record<string, Record<string, unknown>>) {
	const actions = new Map<string, ActionDef>();
	const surfaces = new Map<string, SurfaceDef>();
	const dupes: string[] = [];
	for (const [file, mod] of Object.entries(modules))
		for (const v of Object.values(mod)) {
			if (!isDef(v)) continue;
			const into = v.kind === "action" ? actions : surfaces;
			if (into.has(v.id)) dupes.push(`${v.id} (${file})`);
			into.set(v.id, v as never);
		}
	return { actions, surfaces, dupes };
}

const modules = import.meta.glob<Record<string, unknown>>(
	["../../**/*.actions.ts", "../../**/*.surface.ts"],
	{ eager: true },
);
let built: ReturnType<typeof collect> | null = null;
/** Built on first use: a module still loading in an import cycle has no exports yet. */
const registry = () => {
	built ??= collect(modules);
	return built;
};

export const allActions = (): ActionDef[] =>
	Array.from(registry().actions.values());
export const allSurfaces = (): SurfaceDef[] =>
	Array.from(registry().surfaces.values());
export const duplicateIds = (): string[] => registry().dupes;
export const actionById = (id: string) => registry().actions.get(id);
export const surfaceById = (id: string) => registry().surfaces.get(id);

let keysOf: (id: ActionId) => string | undefined = () => undefined;
/** The shortcut registry tells the menus which keys run an action. */
export function setActionKeys(fn: (id: ActionId) => string | undefined) {
	keysOf = fn;
}

/** A label or icon given as a value or as a function of the object; icons are objects, not functions. */
function value<C, T>(v: T | ((ctx: C) => T), ctx: C): T {
	return typeof v === "function" ? (v as (ctx: C) => T)(ctx) : (v as T);
}

/** A context's typed facts; the only input `when` and `disabled` get. */
const factsOf = (ctx: unknown): Facts =>
	(ctx as { facts?: Facts } | null)?.facts ?? {};

/** One action as a menu row for this object, or null when its `when` fails. */
export function entryOf<Id extends ActionId>(
	id: Id,
	ctx: ActionCtx<Id>,
): MenuEntry | null {
	const a = actionById(id) as ActionDef<Id> | undefined;
	const facts = factsOf(ctx) as ActionFacts<Id>;
	if (!a || (a.when && !a.when(facts))) return null;
	const off = a.disabled?.(facts);
	return {
		// The row's id drops the object prefix, so test ids read `menu-archive`.
		id: id.slice(id.indexOf(".") + 1),
		label: value<ActionCtx<Id>, string>(a.label, ctx),
		icon: value<ActionCtx<Id>, LucideIcon>(a.icon, ctx),
		danger: a.destructive,
		disabled: !!off,
		why: typeof off === "string" ? off : undefined,
		checked: a.checked?.(ctx),
		keys: keysOf(id),
		onSelect: () => a.run(ctx),
	};
}

/** A surface's menu as rows; `-` in the list is a separator. */
export function surfaceEntries<S extends SurfaceId>(
	id: S,
	menu: "context" | "more",
	ctx: SurfaceCtx<S>,
): MenuEntry[] {
	const ids = surfaceById(id)?.menus[menu] ?? [];
	return ids.flatMap((a, i): MenuEntry[] => {
		if (a === "-") return [{ id: `sep-${i}`, separator: true }];
		const e = entryOf(a as ActionId, ctx as never);
		return e ? [e] : [];
	});
}

/** Runs an action by id, as a shortcut or the palette does; false when it can't run. */
export function runAction<Id extends ActionId>(
	id: Id,
	ctx: ActionCtx<Id>,
): boolean {
	const a = actionById(id) as ActionDef<Id> | undefined;
	const facts = factsOf(ctx) as ActionFacts<Id>;
	if (!a || (a.when && !a.when(facts)) || a.disabled?.(facts)) return false;
	a.run(ctx);
	return true;
}

/** The surface the user last focused or right-clicked: the palette lists its actions. */
interface Active {
	id: SurfaceId;
	ctx: () => unknown;
}
let active: Active | null = null;
const listeners = new Set<() => void>();
export function setActiveSurface(next: Active | null) {
	active = next;
	for (const l of Array.from(listeners)) l();
}
export const activeSurface = () => active;
export function onActiveSurface(l: () => void): () => void {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** Every action the focused surface offers, for the palette. */
export function activeEntries(): MenuEntry[] {
	if (!active) return [];
	const s = surfaceById(active.id);
	if (!s) return [];
	const ctx = active.ctx();
	const ids = new Set([...(s.menus.more ?? []), ...(s.menus.context ?? [])]);
	ids.delete("-");
	return Array.from(ids).flatMap((a) => {
		const e = entryOf(a as ActionId, ctx as never);
		return e ? [e] : [];
	});
}
