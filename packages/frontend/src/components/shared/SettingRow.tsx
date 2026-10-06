// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Row } from "./Row";

export interface SettingRowProps {
	label: ReactNode;
	/** One line under the label: what the setting does or what it is set to. */
	description?: ReactNode;
	/** The control, right-aligned: a switch, a button, an input, a state word. */
	children?: ReactNode;
	/** Below the row, full width: an input that needs the room, an error. */
	below?: ReactNode;
	className?: string;
	testId?: string;
}

/**
 * One setting: a Row whose meta says what it does or what it is set to, the
 * control on the right; on a phone the control drops under the label.
 */
export function SettingRow({
	label,
	description,
	children,
	below,
	className,
	testId,
}: SettingRowProps) {
	return (
		<Row
			label={label}
			meta={description}
			trailing={children}
			below={below}
			stackOnPhone
			className={className}
			testId={testId}
		/>
	);
}

/** A titled group of setting rows; a count and one quiet action beside the title. */
export function SettingGroup({
	title,
	count,
	actions,
	description,
	children,
	className,
	testId,
}: {
	title: string;
	count?: number;
	actions?: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<section className={cn("mt-8 first:mt-0", className)} data-testid={testId}>
			<div className="mb-2">
				<div className="flex min-h-6 items-center justify-between gap-3">
					<h3 className="flex items-baseline gap-2 text-heading">
						{title}
						{count !== undefined && (
							<span className="font-normal text-text-3 tabular-nums">
								{count}
							</span>
						)}
					</h3>
					{actions}
				</div>
				{description && <p className="text-meta text-text-3">{description}</p>}
			</div>
			<div>{children}</div>
		</section>
	);
}
