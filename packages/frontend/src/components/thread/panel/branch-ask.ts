// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What "Create branch" asks the agent on a detached worktree (#1176 F2); loads on the click. */
export function branchAsk(b: {
	name: string;
	pushable: boolean;
	repo?: string;
}): string {
	const where = b.repo ? ` in the repository \`${b.repo}\`` : "";
	const make = `Create the branch \`${b.name}\` at HEAD with \`git switch -c ${b.name}\`${where}, commit anything uncommitted,`;
	return b.pushable
		? `${make} then push it with \`git push -u origin ${b.name}\`.`
		: `${make} and stop: this worktree can't push to the project's remote.`;
}
