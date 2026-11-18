// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The contracts' `LIVE_CURSOR_HEADER`, kept here so the shell chunk loads no schema code. */
export const LIVE_CURSOR_HEADER = "x-pl-live-cursor";

/** The earliest change-stream cursor this page's reads began at. */
let earliest: { epoch: string; seq: number; raw: string } | null = null;

/** The first stream message this page applied, and the re-read a read from before it needs. */
let joined: { epoch: string; seq: number; beat: boolean } | null = null;
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

export function noteReadCursor(raw: string | null): void {
	if (!raw) return;
	const [epoch = "", seq] = raw.split(".");
	const n = Number(seq);
	if (!Number.isFinite(n)) return;
	// A response that began before the page joined missed the frames between: re-read once.
	if (
		onLate &&
		joined &&
		(epoch !== joined.epoch || joined.seq > n + (joined.beat ? 0 : 1))
	) {
		const late = onLate;
		onLate = null;
		late();
	}
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
	onLate = null;
}
