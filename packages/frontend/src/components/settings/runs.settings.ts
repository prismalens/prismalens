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

export const runsDisk = define.setting({
	id: "runs.disk",
	page: "runs",
	label: "Disk",
	sentence: "Free space, and every run's workspace by size, with Remove.",
	also: "free space full disk worktree size remove",
});
