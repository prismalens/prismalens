// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The three numbers any scrollable element exposes; an `HTMLElement` satisfies it. */
export interface ScrollGeometry {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
}

/**
 * Slack, in CSS px, for "still at the tail". Above the sub-pixel `scrollTop` /
 * `clientHeight` rounding browsers report at non-100% zoom, and below one event
 * row (~28px) so scrolling up by even a single row disengages following (#280).
 */
export const AT_BOTTOM_THRESHOLD_PX = 16;

export function isAtBottom(
	geometry: ScrollGeometry,
	threshold = AT_BOTTOM_THRESHOLD_PX,
): boolean {
	return (
		geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight <=
		threshold
	);
}

/** What the stream panel remembers between scroll events. */
export interface TailFollow {
	lastTop: number;
	following: boolean;
}

export const INITIAL_TAIL_FOLLOW: TailFollow = { lastTop: 0, following: true };

/**
 * Fold one scroll event into the follow decision. Only a scroll UP stops
 * following: an auto-scroll fires its own scroll event, and by the time that
 * event runs the next row may already have left the viewport short of the
 * bottom — reading that as the reader moving stops following outright (#280).
 */
export function nextTailFollow(
	previous: TailFollow,
	geometry: ScrollGeometry,
): TailFollow {
	if (isAtBottom(geometry)) {
		return { lastTop: geometry.scrollTop, following: true };
	}
	// 1px absorbs the sub-pixel jitter of a scrollTop that did not really move.
	if (geometry.scrollTop < previous.lastTop - 1) {
		return { lastTop: geometry.scrollTop, following: false };
	}
	return { ...previous, lastTop: geometry.scrollTop };
}
