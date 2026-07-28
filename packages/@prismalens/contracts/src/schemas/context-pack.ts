// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The CONTEXT PACK (ADR-0016 §5) — host-assembled facts the rented harness cannot
 * reach by iterating over logs, metrics, and the repo in its cwd. Computed
 * app-side BEFORE dispatch (ADR-0011 amendment 2026-07-09), pulled on demand
 * (ADR-0022), and injected as ORDERED EVIDENCE (ADR-0002).
 *
 * SECURITY (#207): every free-text field here may be attacker-controllable —
 * deploy names and branch names come from outside our trust boundary. Each fact
 * type therefore exposes exactly ONE free-text field, hard-capped, and the
 * engine renders the whole pack inside a fenced DATA-ONLY block. Do not add a
 * second prose field without re-reading the guard in decompose.ts.
 *
 * NOT the same object as `Overlay` (./overlay.ts): that one is POST-report
 * enrichment keyed on report hypotheses. This one is PRE-dispatch input.
 */
import { z } from "zod";

/** A deploy/release/config change that landed in the alert window. */
export const ChangeFactSchema = z.object({
	/**
	 * Which timeline family this came from. Deliberately NARROWER than the DB's
	 * `ChangeEventType` enum (`packages/@prismalens/database/prisma/pg/schema/app.prisma`)
	 * and `ChangeEventTypeSchema` (`./common.ts`) — both of those also allow
	 * `commit`. Commits are out of scope, so `commit` rows are DROPPED by the
	 * host's mapping, never re-labelled as another kind.
	 */
	kind: z.enum(["deployment", "config", "migration", "rollback"]),
	/** Affected service name, when the host could resolve one. */
	service: z.string().max(120).nullable(),
	/** When it landed (ISO 8601). */
	at: z.string(),
	/** Origin system — "render", "vercel", "manual", … */
	source: z.string().max(40),
	/** Stable external identifier (deploy id, version, sha) — no prose. */
	ref: z.string().max(120).nullable(),
	/** THE ONE FREE-TEXT FIELD. Untrusted. Capped. */
	summary: z.string().max(300),
});
export type ChangeFact = z.infer<typeof ChangeFactSchema>;

/** A service one dependency-graph hop from the affected service. */
export const NeighborServiceSchema = z.object({
	name: z.string().min(1).max(120),
	/** "dependency" = the affected service calls it. "dependent" = it calls the affected service. */
	relation: z.enum(["dependency", "dependent"]),
	/** Edge criticality as recorded in the service graph, when set. */
	criticality: z.string().max(40).nullable(),
});
export type NeighborService = z.infer<typeof NeighborServiceSchema>;

/**
 * A past incident this one resembles. ORDERED most → least similar by array
 * position — deliberately NO score (ADR-0002). `matchedOn` carries the honest
 * "why" a number would otherwise stand in for.
 */
export const PriorIncidentFactSchema = z.object({
	/** Human-readable reference, e.g. "INC-142". */
	reference: z.string().max(40),
	/** Untrusted-ish free text (operator-authored). Capped. */
	title: z.string().max(200),
	/** The prior root cause, when that incident produced one. */
	rootCause: z.string().max(500).nullable(),
	/** The alert labels / service name shared with the current incident. */
	matchedOn: z.array(z.string().max(80)).max(10),
});
export type PriorIncidentFact = z.infer<typeof PriorIncidentFactSchema>;

/** A fact family the host TRIED to fill and could not — honest degradation, ADR-0022. */
export const UnavailableFamilySchema = z.object({
	family: z.enum(["changes", "neighbors", "priorIncidents"]),
	/** Why — "provider timeout", "no active connection", "credential rejected". */
	reason: z.string().max(200),
});
export type UnavailableFamily = z.infer<typeof UnavailableFamilySchema>;

export const ContextPackSchema = z.object({
	/** The correlation window these facts were scoped to (ISO). */
	window: z.object({ start: z.string(), end: z.string() }),
	/** Changes in window, most recent first. */
	changes: z.array(ChangeFactSchema).max(20),
	/** One-hop dependency neighbourhood, dependents first. */
	neighbors: z.array(NeighborServiceSchema).max(20),
	/** Prior incidents, most → least similar (array order IS the rank). */
	priorIncidents: z.array(PriorIncidentFactSchema).max(5),
	/** Families the host could not fill. Empty array = everything succeeded. */
	unavailable: z.array(UnavailableFamilySchema).max(3),
	/** When the host assembled this (ISO). */
	assembledAt: z.string(),
});
export type ContextPack = z.infer<typeof ContextPackSchema>;
