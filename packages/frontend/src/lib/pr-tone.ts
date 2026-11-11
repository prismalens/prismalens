// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PR_TONE_TOKEN, type PrTone } from "@prismalens/contracts";

type ToneToken = (typeof PR_TONE_TOKEN)[PrTone];

/** Each tone token's text class; the word beside it always says the state too. */
export const TONE_TOKEN_CLASS: Record<ToneToken, string> = {
	success: "text-ok",
	info: "text-info",
	neutral: "text-neutral",
	warning: "text-warn",
	danger: "text-danger",
	done: "text-done",
	muted: "text-text-3",
};

/** The text class a PR tone paints its mark with. */
export const prToneClass = (tone: PrTone): string =>
	TONE_TOKEN_CLASS[PR_TONE_TOKEN[tone]];
