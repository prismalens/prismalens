// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/mini";

/**
 * A stamp proves one (walk, condition) cell ran under its simulated condition.
 * Only the simulator writes it, from what it observed; a judge never does. A
 * score that rests on a cell without a valid stamp counts as not tested.
 */
const literal: z.ZodMiniType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(literal),
		z.record(z.string(), literal),
	]),
);

export const StampSchema = z.object({
	version: z.literal(1, "must be 1"),
	condition: z.string().check(z.minLength(1)),
	walk: z.string().check(z.minLength(1)),
	simulator: z.string().check(z.minLength(1)),
	/** The condition's profile as the simulator applied it. */
	profile: z.record(z.string(), literal),
	/** What the simulator measured, e.g. rttMs, downKbps, upKbps, drops, cpu. */
	observed: z.record(z.string(), z.number()),
	/** The commit under test and the run that produced the stamp. */
	sha: z
		.string()
		.check(z.regex(/^[0-9a-f]{7,40}$/, "must be a hex commit sha")),
	run: z.string().check(z.minLength(1)),
	at: z.iso.datetime("must be an ISO time"),
	/** Files the run produced (shots, HAR, logs), relative to the stamp, with their sha256. */
	artifacts: z.array(
		z.object({
			path: z.string().check(z.minLength(1)),
			sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/, "must be a sha256")),
		}),
	),
});

export type Stamp = z.infer<typeof StampSchema>;

/** One stamp file per cell: `<walk>__<condition>.json`. */
export const stampFile = (walk: string, condition: string) =>
	`${walk}__${condition}.json`;

export const sha256 = (data: Uint8Array | string) =>
	createHash("sha256").update(data).digest("hex");

/** What a cell's stamp must match. */
export interface StampExpect {
	readonly condition: string;
	readonly walk: string;
	readonly simulator: string;
	readonly profile: Readonly<Record<string, unknown>>;
	/** The fields the simulator promises to observe. */
	readonly stamps: readonly string[];
	readonly sha: string;
	readonly run: string;
	/** Allowed relative gap between a numeric profile value and what was observed; default 0.25. */
	readonly tolerance?: number;
}

const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);

/**
 * Why a stamp does not prove its cell; empty when it does. `read` returns an
 * artifact's bytes by its stamp-relative path, or null when it is missing.
 */
export function stampProblems(
	raw: unknown,
	want: StampExpect,
	read: (path: string) => Uint8Array | null,
): string[] {
	const parsed = StampSchema.safeParse(raw);
	if (!parsed.success)
		return parsed.error.issues.map(
			(i) => `malformed: ${i.path.join(".") || "stamp"} ${i.message}`,
		);
	const s = parsed.data;
	const out: string[] = [];
	if (s.condition !== want.condition)
		out.push(`condition is ${s.condition}, not ${want.condition}`);
	if (s.walk !== want.walk) out.push(`walk is ${s.walk}, not ${want.walk}`);
	if (s.simulator !== want.simulator)
		out.push(`simulator is ${s.simulator}, not ${want.simulator}`);
	if (!same(s.profile, want.profile))
		out.push("profile differs from the condition's");
	if (!want.sha.startsWith(s.sha) && !s.sha.startsWith(want.sha))
		out.push(`sha is ${s.sha}, not ${want.sha}`);
	if (s.run !== want.run) out.push(`run is ${s.run}, not ${want.run}`);
	for (const f of want.stamps)
		if (!(f in s.observed)) out.push(`observed has no ${f}`);
	const tol = want.tolerance ?? 0.25;
	for (const [k, v] of Object.entries(want.profile)) {
		const seen = s.observed[k];
		if (typeof v !== "number" || seen === undefined) continue;
		if (Math.abs(seen - v) > Math.abs(v) * tol)
			out.push(`observed ${k} ${seen} is outside ${tol * 100}% of ${v}`);
	}
	for (const a of s.artifacts) {
		const bytes = read(a.path);
		if (!bytes) out.push(`artifact ${a.path} is missing`);
		else if (sha256(bytes) !== a.sha256)
			out.push(`artifact ${a.path} does not match its hash`);
	}
	return out;
}

/** Reads and checks the stamp for one cell in a stamps directory. */
export function checkStampFile(dir: string, want: StampExpect): string[] {
	const file = join(dir, stampFile(want.walk, want.condition));
	if (!existsSync(file)) return [`no stamp at ${file}`];
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return [`${file} is not JSON`];
	}
	return stampProblems(raw, want, (p) => {
		const abs = join(dir, p);
		return existsSync(abs) ? readFileSync(abs) : null;
	});
}

/**
 * The simulator's writer: hashes the artifacts (paths relative to `dir`), checks
 * the result against the schema and writes the cell's stamp file.
 */
export function writeStamp(
	dir: string,
	stamp: Omit<Stamp, "version" | "artifacts" | "at"> & { at?: string },
	artifacts: readonly string[],
): string {
	const full: Stamp = {
		version: 1,
		...stamp,
		at: stamp.at ?? new Date().toISOString(),
		artifacts: artifacts.map((path) => ({
			path,
			sha256: sha256(readFileSync(join(dir, path))),
		})),
	};
	StampSchema.parse(full);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, stampFile(stamp.walk, stamp.condition));
	writeFileSync(file, `${JSON.stringify(full, null, "\t")}\n`);
	return file;
}
