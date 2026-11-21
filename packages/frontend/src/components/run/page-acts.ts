// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Actions an incident row hands to the incident's page, which holds their dialogs: `?act=` names one (#1127). */
export const PAGE_ACTS = [
	"resolve",
	"note",
	"statusUpdate",
	"merge",
	"editCause",
	"investigateAgain",
] as const;
export type PageAct = (typeof PAGE_ACTS)[number];
