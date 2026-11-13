// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** A page the agent published: Copy takes its HTML source. */
export interface ArtifactSourceData {
	html: string;
}

export const artifactSourceBlock = define.block<ArtifactSourceData>({
	id: "artifact.source",
	label: "Page source",
	copyLabel: "Copy source",
	text: (d) => d.html,
	marks: [],
	states: { default: "block-artifact", phone: "block-artifact" },
});
