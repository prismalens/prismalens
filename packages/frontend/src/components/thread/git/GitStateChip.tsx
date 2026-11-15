// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitState } from "@prismalens/contracts";
import { forwardRef } from "react";
import { Mark } from "@/components/kit/Mark";
import { markLook } from "@/components/kit/marks";
import { surfaceEntries } from "@/components/kit/registry";
import { Strip, StripAction } from "@/components/kit/Strip";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";
import { gitLine, gitWord } from "./git-state";
import type { GitStateCtx } from "./git-state.actions";

/** The row's git mark: the icon and short word tinted, the state and its next step in the hint. */
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

/**
 * The thread's own line on the git state (#1101 bar 15.1): the mark, the state in a sentence
 * and its next steps as the strip's actions, from the same `gitState.*` actions as the chip.
 */
export function GitStateStrip({ ctx }: { ctx: GitStateCtx }) {
	const look = markLook("gitState", ctx.git.state);
	const steps = surfaceEntries("git.strip", "more", ctx).flatMap((e) =>
		"separator" in e ? [] : [e],
	);
	return (
		<Surface id="git.strip" ctx={ctx}>
			<Strip
				glyph={
					<look.icon
						aria-hidden
						className={cn(
							"size-3.5 shrink-0 self-center stroke-[1.75]",
							look.className,
						)}
					/>
				}
				head={gitWord(ctx.git)}
				detail={gitLine(ctx.git)}
				testId="git-state-strip"
				actions={steps.map((e) => (
					<StripAction
						key={e.id}
						disabled={e.disabled}
						title={e.why}
						onClick={e.onSelect}
						testId={`git-state-strip-${e.id}`}
					>
						{e.label}
					</StripAction>
				))}
			/>
		</Surface>
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
