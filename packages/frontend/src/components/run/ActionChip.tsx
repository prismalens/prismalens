// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown } from "lucide-react";
import { CHIP } from "@/components/agent/AgentPicker";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One thing the box's send can do: Ask, Investigate again, Note, Continue Run 2, Message. */
export interface ComposerAction {
	id: string;
	label: string;
	/** One line in the menu: what happens and where the result goes. */
	detail: string;
	/** Send does nothing on an empty box. */
	needsText: boolean;
}

/**
 * The box's first chip (#811): what Send does. With one action it is a
 * label; with more, a menu (Radix: arrow keys move, Enter picks, Esc closes).
 */
export function ActionChip({
	actions,
	value,
	onChange,
	disabled,
}: {
	actions: ComposerAction[];
	value: string;
	onChange: (id: string) => void;
	disabled?: boolean;
}) {
	const current = actions.find((a) => a.id === value) ?? actions[0];
	if (!current) return null;
	if (actions.length < 2)
		return (
			<span
				className={cn(CHIP, "pointer-events-none text-text-1")}
				data-testid="action-chip"
				data-action={current.id}
			>
				{current.label}
			</span>
		);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className={cn(CHIP, "text-text-1")}
					aria-label={`Send: ${current.label}`}
					data-testid="action-chip"
					data-action={current.id}
				>
					{current.label}
					<ChevronDown className="size-3 shrink-0 text-text-3" aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side="top"
				align="start"
				sideOffset={6}
				className="w-[min(360px,calc(100vw-32px))] rounded-surface"
				data-testid="action-menu"
			>
				<DropdownMenuRadioGroup value={current.id} onValueChange={onChange}>
					{actions.map((a) => (
						<DropdownMenuRadioItem
							key={a.id}
							value={a.id}
							className="h-auto flex-col items-start gap-0.5 py-2"
							data-testid={`action-${a.id}`}
						>
							<span className="font-medium text-text-1">{a.label}</span>
							<span className="text-meta text-text-2">{a.detail}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
