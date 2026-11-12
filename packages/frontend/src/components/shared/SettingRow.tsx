// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { Help } from "@/components/kit/Help";
import { Button } from "@/components/ui/button";
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
	/** Also the row's anchor, so Settings search can land on it. */
	testId?: string;
	/** Set away from its default: the row offers Reset (#1101 cat 18). */
	changed?: boolean;
	onReset?: () => void;
	/** Read-only here: the reason, shown in place of Reset. */
	locked?: string;
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
	changed,
	onReset,
	locked,
}: SettingRowProps) {
	const reset = changed && onReset && !locked && (
		<Button
			variant="ghost"
			size="sm"
			onClick={onReset}
			data-testid={testId ? `${testId}-reset` : undefined}
		>
			Reset
		</Button>
	);
	// A sentence about the setting is opt-in behind one ?; a live state stays on the row (sheet §0.3).
	const explains = typeof description === "string";
	const shown = explains ? undefined : description;
	return (
		<Row
			label={
				explains ? (
					<span className="inline-flex min-w-0 items-center gap-1">
						<span className="min-w-0 truncate">{label}</span>
						<Help
							about={typeof label === "string" ? label : "This setting"}
							text={description}
						/>
					</span>
				) : (
					label
				)
			}
			meta={
				locked ? (
					<>
						{shown}
						{shown && " "}
						<span className="text-text-3" data-testid="host-only">
							{locked}
						</span>
					</>
				) : (
					shown
				)
			}
			trailing={
				reset ? (
					<>
						{reset}
						{children}
					</>
				) : (
					children
				)
			}
			below={below}
			stackOnPhone
			className={className}
			testId={testId}
			anchor={testId}
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
		<section
			id={testId}
			className={cn("mt-8 scroll-mt-24 first:mt-0", className)}
			data-testid={testId}
		>
			<div className="mb-3">
				<div className="flex min-h-5 items-center justify-between gap-3">
					<h3 className="flex items-baseline gap-2 text-body font-medium text-text-2">
						{title}
						{count !== undefined && (
							<span className="font-normal text-text-3 tabular-nums">
								{count}
							</span>
						)}
					</h3>
					{actions}
				</div>
				{description && (
					<p className="mt-0.5 text-meta text-text-3">{description}</p>
				)}
			</div>
			<div>{children}</div>
		</section>
	);
}
