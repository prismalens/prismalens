// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

/**
 * One form field in Resolve's language (look ruling §2, Dialog): the name in
 * 500, an optional quiet note beside it, the control under it, and one line
 * under that for a hint or the field's error. No asterisk, no "(optional)".
 * A function child gets that line's id for the control's `aria-describedby`.
 */
export function Field({
	label,
	note,
	htmlFor,
	hint,
	error,
	className,
	children,
}: {
	label: string;
	note?: string;
	htmlFor?: string;
	/** One quiet line under the control. */
	hint?: ReactNode;
	/** Replaces the hint while the field is wrong. */
	error?: string | false | null;
	className?: string;
	children: ReactNode | ((describedBy: string | undefined) => ReactNode);
}) {
	const messageId = useId();
	const describedBy = error || hint ? messageId : undefined;
	return (
		<div className={cn("min-w-0 space-y-1.5", className)}>
			<label htmlFor={htmlFor} className="block truncate text-body">
				<span className="font-medium">{label}</span>
				{note && <span className="text-text-3"> {note}</span>}
			</label>
			{typeof children === "function" ? children(describedBy) : children}
			{error ? (
				<p id={messageId} role="alert" className="text-meta text-danger">
					{error}
				</p>
			) : (
				hint && (
					<p id={messageId} className="text-meta text-text-3">
						{hint}
					</p>
				)
			)}
		</div>
	);
}
