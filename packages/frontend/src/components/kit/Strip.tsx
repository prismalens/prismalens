// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ComponentProps, ReactNode } from "react";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";
import { Status, type StatusKind } from "./Status";

/**
 * The one failure strip on the composer's top edge (pattern sheet §10, #1101):
 * the state in bold, one plain detail, quiet text actions on the right.
 */
export function Strip({
	status,
	head,
	detail,
	actions,
	label,
	title,
	testId,
	live,
}: {
	status: StatusKind;
	head: string;
	detail?: ReactNode;
	actions?: ReactNode;
	/** The landmark's name; the head when absent. */
	label?: string;
	/** One line more, on hover. */
	title?: string;
	testId?: string;
	/** Announce changes politely, for a strip that appears on its own. */
	live?: boolean;
}) {
	return (
		<section
			aria-label={label ?? head}
			role={live ? "status" : undefined}
			className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-t-[8px] bg-warn/10 px-3 pt-1.5 pb-2.5 text-meta"
			data-testid={testId}
		>
			<span className="flex grow items-baseline gap-1.5">
				<Status kind={status} showWord={false} className="self-center" />
				<Hint label={title ?? head} when={!!title}>
					<span
						className="shrink-0 font-semibold text-text-1"
						data-testid={testId && `${testId}-head`}
					>
						{head}
					</span>
				</Hint>
				{detail && (
					<span
						className="text-text-2 tabular-nums"
						data-testid={testId && `${testId}-detail`}
					>
						{detail}
					</span>
				)}
			</span>
			{actions && (
				<span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
					{actions}
				</span>
			)}
		</section>
	);
}

const ACTION =
	"inline-flex h-6 items-center gap-1 rounded-control text-meta font-medium text-text-1 outline-none hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:text-text-3";

/** A quiet text action on a strip; it takes a menu trigger's props as one. */
export function StripAction({
	children,
	href,
	testId,
	className,
	...rest
}: ComponentProps<"button"> & { href?: string; testId?: string }) {
	if (href)
		return (
			<a
				href={href}
				target="_blank"
				rel="noreferrer"
				className={cn(ACTION, className)}
				data-testid={testId}
			>
				{children}
			</a>
		);
	return (
		<button
			type="button"
			{...rest}
			className={cn(ACTION, className)}
			data-testid={testId}
		>
			{children}
		</button>
	);
}
