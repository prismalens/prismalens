// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The contracts' `LIVE_CURSOR_HEADER`, kept here so the shell chunk loads no schema code. */
export const LIVE_CURSOR_HEADER = "x-pl-live-cursor";

/** The earliest change-stream cursor this page's reads began at. */
let earliest: { epoch: string; seq: number; raw: string } | null = null;

/** The first stream message this page applied, and the re-read a read from before it needs. */
let joined: { epoch: string; seq: number; beat: boolean } | null = null;
/** The newest stream message this page has applied: the frames after the join are in it too. */
let latest: { epoch: string; seq: number } | null = null;
let onLate: (() => void) | null = null;

export function noteJoined(
	cursor: string,
	beat: boolean,
	late: () => void,
): void {
	if (joined) return;
	const [epoch = "", seq] = cursor.split(".");
	joined = { epoch, seq: Number(seq), beat };
	onLate = late;
}

/** Every stream message the page applies, a frame after the join included. */
export function noteApplied(cursor: string): void {
	const [epoch = "", seq] = cursor.split(".");
	const n = Number(seq);
	if (!Number.isFinite(n)) return;
	if (!latest || latest.epoch !== epoch || n > latest.seq)
		latest = { epoch, seq: n };
}

/**
 * A response from this cursor began before the page joined, and missed the frames between. An
 * early answer a query takes after the join also missed every frame applied before the query
 * existed, the first included: no query existed for those to re-read, so only a cursor at or
 * past the newest applied message is current.
 */
export function beforeJoin(raw: string | null, early = false): boolean {
	if (!raw || !joined) return false;
	const [epoch = "", seq] = raw.split(".");
	const n = Number(seq);
	if (!Number.isFinite(n)) return false;
	if (early) {
		const newest = latest ?? joined;
		return epoch !== newest.epoch || newest.seq > n;
	}
	return epoch !== joined.epoch || joined.seq > n + (joined.beat ? 0 : 1);
}

export function noteReadCursor(raw: string | null): void {
	if (!raw) return;
	const [epoch = "", seq] = raw.split(".");
	const n = Number(seq);
	if (!Number.isFinite(n)) return;
	if (onLate && beforeJoin(raw)) onLate();
	// Another epoch than the first read's is a restart since: keep the older one, so it resets.
	if (!earliest || (earliest.epoch === epoch && n < earliest.seq))
		earliest = { epoch, seq: n, raw };
}

export const readCursor = (): string | undefined => earliest?.raw;

/** Frames came after this page's reads: a beat past it, or a frame past the one right after it. */
export function missedSince(cursor: string, beat: boolean): boolean {
	if (!earliest) return false;
	const [epoch, seq] = cursor.split(".");
	if (epoch !== earliest.epoch) return true;
	return Number(seq) > earliest.seq + (beat ? 0 : 1);
}

/** Tests start from a page with no reads. */
export function forgetReadCursor(): void {
	earliest = null;
	joined = null;
	latest = null;
	onLate = null;
}
