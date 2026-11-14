// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

const STEPS = [
	"gitState.resolve",
	"gitState.openFiles",
	"gitState.reread",
	"gitState.compare",
	"gitState.restore",
	"gitState.settle",
] as const;

/** The git-state chip in the thread header: a click or right-click lists the state's next steps. */
export const gitStateChip = defineSurface({
	id: "git.state",
	object: "gitState",
	label: "Git state",
	menus: { context: [...STEPS], more: [...STEPS] },
	states: { default: "git-state-chip", phone: "git-state-chip" },
	marks: ["gitState"],
});
