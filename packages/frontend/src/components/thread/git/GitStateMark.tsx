// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitState } from "@prismalens/contracts";
import { Mark } from "@/components/kit/Mark";
import { markLook } from "@/components/kit/marks";
import { cn } from "@/lib/utils";
import { gitLine, gitWord } from "./git-state";

/**
 * The row's git mark: the icon and short word tinted, the state and its next step in the hint.
 * Its own file: the sidebar draws it on every first paint, without the chip's actions (#1130).
 */
export function GitStateMark({ git }: { git: GitState }) {
	const look = markLook("gitState", git.state);
	return (
		<Mark
			id="gitState"
			state={git.state}
			word={gitLine(git)}
			testId="mark-git-state"
		>
			<span className={cn("whitespace-nowrap text-meta", look.className)}>
				{gitWord(git)}
			</span>
		</Mark>
	);
}
