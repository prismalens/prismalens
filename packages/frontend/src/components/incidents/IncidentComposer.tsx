// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { CornerDownLeft } from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Mono } from "@/components/shared/Mono";
import { cn } from "@/lib/utils";

export interface ComposerCommand {
	/** Typed after the slash: `investigate`, `close`. */
	name: string;
	/** One line under the name in the picker. */
	hint: string;
	run: () => void;
	/** A command the record cannot take right now stays listed, greyed, with the reason. */
	disabledReason?: string;
}

export interface IncidentComposerProps {
	incidentNumber: number;
	commands: ComposerCommand[];
	/** Plain text lands on the timeline as a note. */
	onNote: (text: string) => void;
	isPending?: boolean;
}

/**
 * The composer dock: the record's one input. Plain text is a timeline note;
 * `/` opens the commands the record can take. When steer lands it is the same
 * strip, and nothing else on the page moves.
 */
export function IncidentComposer({
	incidentNumber,
	commands,
	onNote,
	isPending,
}: IncidentComposerProps) {
	const [text, setText] = useState("");
	const [highlight, setHighlight] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();

	const isCommand = text.startsWith("/");
	const query = isCommand ? text.slice(1).trim().toLowerCase() : "";
	const matches = useMemo(
		() => (isCommand ? commands.filter((c) => c.name.startsWith(query)) : []),
		[commands, isCommand, query],
	);

	useEffect(() => {
		setHighlight(0);
	}, [query]);

	// `/` anywhere on the page focuses the composer, unless the operator is already typing.
	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)
				return;
			e.preventDefault();
			inputRef.current?.focus();
			setText("/");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const runCommand = (command: ComposerCommand) => {
		if (command.disabledReason) return;
		command.run();
		setText("");
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (isCommand) {
			const pick = matches[highlight];
			if (pick) runCommand(pick);
			return;
		}
		const note = text.trim();
		if (!note) return;
		onNote(note);
		setText("");
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (!isCommand || matches.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlight((h) => (h + 1) % matches.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlight((h) => (h - 1 + matches.length) % matches.length);
		} else if (e.key === "Escape") {
			setText("");
		}
	};

	return (
		<div
			className="border-t bg-background px-4 pb-2 pt-2 sm:px-6"
			data-testid="incident-composer"
		>
			{isCommand && (
				<div
					id={listId}
					role="listbox"
					className="mb-2 max-w-xl overflow-hidden rounded-md border bg-popover shadow-sm"
					data-testid="composer-commands"
				>
					{matches.length === 0 && (
						<div className="px-3 py-2 text-record text-muted-foreground">
							No command matches <Mono>/{query}</Mono>
						</div>
					)}
					{matches.map((command, i) => (
						<div
							key={command.name}
							role="option"
							tabIndex={-1}
							aria-selected={i === highlight}
							aria-disabled={!!command.disabledReason}
							data-testid={`composer-command-${command.name}`}
							className={cn(
								"flex cursor-pointer items-baseline gap-3 px-3 py-1.5 text-record",
								i === highlight && "bg-muted",
								command.disabledReason && "cursor-not-allowed opacity-60",
							)}
							onMouseEnter={() => setHighlight(i)}
							onMouseDown={(e) => {
								e.preventDefault();
								runCommand(command);
							}}
						>
							<Mono className="w-28 shrink-0">/{command.name}</Mono>
							<span className="text-muted-foreground">
								{command.disabledReason ?? command.hint}
							</span>
						</div>
					))}
				</div>
			)}
			<form onSubmit={submit} className="flex items-center gap-2">
				<Mono className="shrink-0 text-record text-primary">
					INC-{incidentNumber} ›
				</Mono>
				<input
					ref={inputRef}
					role="combobox"
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKeyDown}
					disabled={isPending}
					placeholder="Add a note to the timeline, or type / for commands"
					aria-label="Composer"
					aria-autocomplete="list"
					aria-controls={isCommand ? listId : undefined}
					aria-expanded={isCommand}
					data-testid="composer-input"
					className="h-9 min-w-0 flex-1 bg-transparent text-record outline-none placeholder:text-muted-foreground disabled:opacity-60"
				/>
				<span className="hidden items-center gap-1 text-meta text-muted-foreground sm:inline-flex">
					<CornerDownLeft className="h-3 w-3" />
					{isCommand ? "run" : "note"}
				</span>
			</form>
		</div>
	);
}
