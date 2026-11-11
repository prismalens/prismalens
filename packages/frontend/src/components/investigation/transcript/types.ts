// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import type { ComponentType } from "react";

export interface TranscriptNodeProps {
	event: CanonicalEvent;
	runId?: string;
	incidentId: string | null;
}

/** One event kind the transcript's own branches leave unhandled, drawn by a lane. */
export interface TranscriptNodeEntry {
	Node: ComponentType<TranscriptNodeProps>;
}

export type TranscriptNodes = Partial<
	Record<CanonicalEvent["kind"], TranscriptNodeEntry>
>;
