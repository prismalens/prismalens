// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { ChevronDown, MessageSquare, Search } from "lucide-react";
import { useState } from "react";
import { CHIP } from "@/components/agent/AgentPicker";
import { Hint } from "@/components/shared/Hint";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { RunVerb } from "@/lib/run-verb";

const NAME: Record<RunVerb, string> = {
	investigate: "Investigate",
	ask: "Ask",
};
const ICON: Record<RunVerb, typeof Search> = {
	investigate: Search,
	ask: MessageSquare,
};

/** The box's first chip (#673 w59): what the next message asks for; Enter does it. */
export function VerbChip({
	verbs,
	verb,
	copy,
	onVerb,
	disabled,
}: {
	verbs: RunVerb[];
	verb: RunVerb;
	copy: Record<RunVerb, string>;
	onVerb: (verb: RunVerb) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const Icon = ICON[verb];
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Hint label="What the next message asks for" keys={["Enter"]} side="top">
				<PopoverTrigger
					disabled={disabled}
					className={CHIP}
					data-testid="verb-chip"
					data-verb={verb}
					aria-label={`Next message: ${NAME[verb]}`}
				>
					<Icon className="size-3.5 shrink-0" aria-hidden />
					<span>{NAME[verb]}</span>
					<ChevronDown className="size-3.5 shrink-0 text-text-3" aria-hidden />
				</PopoverTrigger>
			</Hint>
			<PopoverContent
				side="top"
				align="start"
				sideOffset={6}
				className="w-[min(380px,calc(100vw-32px))] rounded-surface p-1"
				data-testid="verb-menu"
			>
				<Listbox
					aria-label="What the next message asks for"
					value={verb}
					onValueChange={(v) => {
						setOpen(false);
						if (v && v !== verb) onVerb(v as RunVerb);
					}}
				>
					{verbs.map((v) => {
						const RowIcon = ICON[v];
						return (
							<ListboxItem
								key={v}
								value={v}
								className="grid w-full cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 rounded-control px-2.5 py-2 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3 focus-visible:bg-surface-3 data-highlighted:bg-surface-3 data-selected:bg-surface-3"
								data-testid={`verb-${v}`}
							>
								<RowIcon className="size-3.5 text-text-2" aria-hidden />
								<span className="text-body font-medium text-text-1">
									{NAME[v]}
								</span>
								<span className="col-start-2 text-meta text-text-2">
									{copy[v]}
								</span>
							</ListboxItem>
						);
					})}
				</Listbox>
				<p className="px-2.5 pt-2 pb-1 text-meta text-text-3">
					Enter does what the chip says. A different agent, model or mode starts
					a new run.
				</p>
			</PopoverContent>
		</Popover>
	);
}
