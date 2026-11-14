// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitState } from "@prismalens/contracts";
import { forwardRef } from "react";
import { Mark } from "@/components/kit/Mark";
import { markLook } from "@/components/kit/marks";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";
import { gitLine, gitWord } from "./git-state";
import type { GitStateCtx } from "./git-state.actions";

/** The row's git mark: the icon tinted, the state and its next step in the hint. */
export function GitStateMark({ git }: { git: GitState }) {
	return (
		<Mark
			id="gitState"
			state={git.state}
			word={gitLine(git)}
			testId="mark-git-state"
		/>
	);
}

const Trigger = forwardRef<
	HTMLButtonElement,
	{ git: GitState; phone?: boolean } & React.ComponentProps<"button">
>(function Trigger({ git, phone, className, ...rest }, ref) {
	const look = markLook("gitState", git.state);
	return (
		<button
			ref={ref}
			type="button"
			aria-label={`${gitWord(git)}. ${gitLine(git)} Next steps`}
			className={cn(
				"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-meta text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 data-[state=open]:bg-surface-3",
				phone && "size-11 justify-center px-0",
				className,
			)}
			data-testid="thread-git-state"
			data-state={git.state}
			{...rest}
		>
			<look.icon
				aria-hidden
				className={cn("size-3.5 shrink-0 stroke-[1.75]", look.className)}
			/>
			{!phone && <span className="whitespace-nowrap">{gitWord(git)}</span>}
		</button>
	);
});

/**
 * The header's git state (#1101 bar 15.1): icon, colour and the short word; the hint says
 * what happened, and a click or right-click lists the next steps from `git.state`.
 */
export function GitStateChip({
	ctx,
	phone,
}: {
	ctx: GitStateCtx;
	phone?: boolean;
}) {
	return (
		<Surface id="git.state" ctx={ctx}>
			<span className="inline-flex">
				<Hint label={gitLine(ctx.git)}>
					<span className="inline-flex">
						<SurfaceMore
							id="git.state"
							ctx={ctx}
							align="end"
							trigger={<Trigger git={ctx.git} phone={phone} />}
						/>
					</span>
				</Hint>
			</span>
		</Surface>
	);
}
