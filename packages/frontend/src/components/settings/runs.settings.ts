// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const runsRunWorkspaces = define.setting({
	id: "runs.runWorkspaces",
	page: "runs",
	label: "Run workspaces",
	sentence: "Where a run checks out the code, and what is kept.",
	also: "worktree checkout disk",
});
