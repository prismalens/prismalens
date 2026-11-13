// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import type { LucideIcon } from "lucide-react";
import type {
	ActionObjects as GeneratedActionObjects,
	ObjectContexts as GeneratedObjectContexts,
	ObjectStates as GeneratedObjectStates,
	SurfaceObjects as GeneratedSurfaceObjects,
} from "@/registry/registry.gen";
import type { MarkId } from "./marks";

/**
 * The surface and action registry (#1125): an action is declared once by id in a
 * `*.actions.ts`, a surface places ids into its menus in a `*.surface.ts`, and the
 * menus, the palette and the shortcuts all run it by id. Each file widens the
 * three maps below with `declare module "@/components/kit/actions"`, so the ids are
 * typed unions with no central list.
 */

/** Object kind → the context its actions run with, e.g. `thread: ThreadCtx`. */
// biome-ignore lint/suspicious/noEmptyInterface: generated from the registry, still widened by the remaining declare module blocks.
export interface ObjectContexts extends GeneratedObjectContexts {}
/** Action id → its object kind, e.g. `"thread.archive": "thread"`. */
// biome-ignore lint/suspicious/noEmptyInterface: generated from the registry, still widened by the remaining declare module blocks.
export interface ActionObjects extends GeneratedActionObjects {}
/** Surface id → the object kind it shows, e.g. `"thread.row": "thread"`. */
// biome-ignore lint/suspicious/noEmptyInterface: generated from the registry, still widened by the remaining declare module blocks.
export interface SurfaceObjects extends GeneratedSurfaceObjects {}

/** Object kind → the yes/no states its actions may test, e.g. `thread: "running" | "pinned"`. */
// biome-ignore lint/suspicious/noEmptyInterface: generated from the registry, still widened by the remaining declare module blocks.
export interface ObjectStates extends GeneratedObjectStates {}
/** Paid capability flags (#264): the flag seam widens this with each flag id. */
// biome-ignore lint/suspicious/noEmptyInterface: widened by declaration merging.
export interface CapabilityFlags {}
/** What an integration can do, e.g. a code host's `rerunJob` (#1122). */
// biome-ignore lint/suspicious/noEmptyInterface: widened by declaration merging.
export interface IntegrationCapabilities {}

/**
 * The only things a `when` or `disabled` may read: typed facts, never a string
 * check inside a component. A context carries them as `facts`.
 */
export interface Facts<State extends string = string> {
	access?: AccessLevel;
	flags?: { readonly [F in keyof CapabilityFlags]?: boolean };
	can?: { readonly [C in keyof IntegrationCapabilities]?: boolean };
	is?: { readonly [S in State]?: boolean };
}

export type ObjectKind = keyof ObjectContexts & string;
export type ActionId = keyof ActionObjects & string;
export type SurfaceId = keyof SurfaceObjects & string;

type CtxOf<K> = K extends ObjectKind ? ObjectContexts[K] : never;
type StatesOf<K> = K extends keyof ObjectStates
	? ObjectStates[K] & string
	: never;
export type ActionFacts<Id extends ActionId> = Facts<
	StatesOf<ActionObjects[Id]>
>;
export type ActionCtx<Id extends ActionId> = CtxOf<ActionObjects[Id]>;
export type SurfaceCtx<Id extends SurfaceId> = CtxOf<SurfaceObjects[Id]>;

/** The action ids a surface may place: those declared for its object kind. */
export type ActionsOf<S extends SurfaceId> = {
	[A in ActionId]: ActionObjects[A] extends SurfaceObjects[S] ? A : never;
}[ActionId];

type Of<Ctx, T> = T | ((ctx: Ctx) => T);

export interface ActionDef<Id extends ActionId = ActionId> {
	readonly kind: "action";
	id: Id;
	label: Of<ActionCtx<Id>, string>;
	icon: Of<ActionCtx<Id>, LucideIcon>;
	/** Drawn last, behind a separator, in the danger colour. */
	destructive?: boolean;
	/** Listed only when this holds for the object's facts. */
	when?: (facts: ActionFacts<Id>) => boolean;
	/** Listed but not runnable; a string says why. */
	disabled?: (facts: ActionFacts<Id>) => boolean | string;
	/** A choice that is on: a tick at the menu row's end. */
	checked?: (ctx: ActionCtx<Id>) => boolean;
	run: (ctx: ActionCtx<Id>) => void;
}

export interface SurfaceDef<Id extends SurfaceId = SurfaceId> {
	readonly kind: "surface";
	id: Id;
	/** The object it shows, when its id's first part names something else (`diff.file` shows a `diffFile`). */
	object?: string;
	/** The accessible name of its menus, e.g. "Thread actions". */
	label: string;
	menus: {
		/** Right-click, Shift+F10, the Menu key and a long press. */
		context?: readonly (ActionsOf<Id> | "-")[];
		/** The visible ⋯ menu. */
		more?: readonly (ActionsOf<Id> | "-")[];
	};
	/** Named states → the gallery ids that draw them (`data-kit-state` or section ids under `design/`). */
	states: { readonly default: string; readonly phone: string } & Readonly<
		Record<string, string>
	>;
	/** The metadata marks it shows, from `kit/marks.ts`. */
	marks: readonly MarkId[];
}

export function defineAction<Id extends ActionId>(
	def: Omit<ActionDef<Id>, "kind">,
): ActionDef<Id> {
	return { kind: "action", ...def };
}

export function defineSurface<Id extends SurfaceId>(
	def: Omit<SurfaceDef<Id>, "kind">,
): SurfaceDef<Id> {
	return { kind: "surface", ...def };
}
