// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TerminalUnavailableReason } from "@prismalens/contracts";
import { ChevronDown, ChevronUp, Plus, SquareTerminal, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CommandChip } from "@/components/ui/command-chip";
import { terminalStore, useTerminalState } from "@/lib/terminal/store";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";
import { cn } from "@/lib/utils";
import { TerminalView } from "./TerminalView";

export const TERMINAL_DOCS_URL = "https://docs.prismalens.io/terminal";

/**
 * The terminal panel the layout's bottom slot mounts (#931, #973). The layout
 * owns opening, size and maximising; it passes the handlers, and the panel
 * shows their buttons only when it has them.
 */
export function TerminalPanel({
	maximised,
	onToggleMaximise,
	onHide,
}: {
	maximised?: boolean;
	onToggleMaximise?: () => void;
	onHide?: () => void;
}) {
	const availability = useTerminalAvailability();
	const tabs = useTerminalState((s) => s.tabs);
	const active = useTerminalState((s) => s.active);
	const ready = availability?.available === true;

	useEffect(() => terminalStore.registerHost(), []);
	useEffect(() => {
		if (ready && terminalStore.get().tabs.length === 0) terminalStore.newTab();
	}, [ready]);

	return (
		<section
			aria-label="Terminal"
			className="flex h-full min-h-0 flex-col bg-surface-1"
			data-testid="terminal-panel"
		>
			<div className="flex h-9 flex-none items-center gap-0.5 pr-1.5 pl-2">
				<div
					role="tablist"
					aria-label="Terminals"
					className="flex min-w-0 gap-0.5 overflow-x-auto"
				>
					{ready
						? tabs.map((tab) => (
								<div
									key={tab.id}
									className={cn(
										"group flex h-7 flex-none items-center rounded-control text-body",
										tab.id === active
											? "bg-surface-3 text-text-1"
											: "text-text-2 hover:bg-surface-2",
									)}
								>
									<button
										type="button"
										role="tab"
										aria-selected={tab.id === active}
										className="flex h-full max-w-56 items-center gap-1.5 truncate pr-1 pl-2.5"
										onClick={() => terminalStore.activate(tab.id)}
									>
										<SquareTerminal
											className="size-3.5 flex-none"
											aria-hidden
										/>
										<span className="truncate">{tab.title}</span>
									</button>
									<button
										type="button"
										aria-label={`Close ${tab.title}`}
										className="mr-1 grid size-5 place-items-center rounded-sm opacity-0 group-hover:opacity-70 hover:bg-surface-4 focus-visible:opacity-100 group-[&:has([aria-selected=true])]:opacity-70"
										onClick={() => terminalStore.closeTab(tab.id)}
									>
										<X className="size-3" aria-hidden />
									</button>
								</div>
							))
						: null}
				</div>
				{ready ? (
					<Button
						type="button"
						variant="text"
						size="icon-sm"
						aria-label="New terminal"
						onClick={() => terminalStore.newTab()}
					>
						<Plus aria-hidden />
					</Button>
				) : null}
				<span className="flex-1" />
				{onToggleMaximise ? (
					<Button
						type="button"
						variant="text"
						size="icon-sm"
						aria-label={
							maximised ? "Restore the terminal" : "Maximise the terminal"
						}
						onClick={onToggleMaximise}
					>
						{maximised ? (
							<ChevronDown aria-hidden />
						) : (
							<ChevronUp aria-hidden />
						)}
					</Button>
				) : null}
				{onHide ? (
					<Button
						type="button"
						variant="text"
						size="icon-sm"
						aria-label="Hide the terminal"
						onClick={onHide}
					>
						<X aria-hidden />
					</Button>
				) : null}
			</div>
			{availability === undefined ? null : availability.available ? (
				<Shells />
			) : (
				<Unavailable reason={availability.reason} />
			)}
		</section>
	);
}

function Shells() {
	const tabs = useTerminalState((s) => s.tabs);
	const active = useTerminalState((s) => s.active);
	return (
		<div className="mx-1.5 mb-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-control bg-canvas">
			{tabs.map((tab) => (
				<TerminalView key={tab.id} tabId={tab.id} active={tab.id === active} />
			))}
			{tabs.map((tab) =>
				tab.id === active ? <TabFooter key={tab.id} tabId={tab.id} /> : null,
			)}
		</div>
	);
}

function TabFooter({ tabId }: { tabId: number }) {
	const tab = useTerminalState((s) => s.tabs.find((t) => t.id === tabId));
	if (!tab) return null;
	if (tab.exitCode !== undefined) {
		return (
			<p
				className="flex-none px-3 py-1.5 text-meta text-text-3"
				data-testid="terminal-exited"
			>
				{tab.exitCode === null
					? "The shell ended."
					: `The shell exited with code ${tab.exitCode}.`}
			</p>
		);
	}
	if (!tab.draft) return null;
	const inputId = `terminal-draft-${tabId}`;
	return (
		<div
			className="flex flex-none items-center gap-2.5 bg-surface-2 py-1.5 pr-1.5 pl-3 focus-within:shadow-[inset_0_0_0_2px_var(--accent)]"
			data-testid="terminal-draft"
		>
			<label
				htmlFor={inputId}
				className="whitespace-nowrap text-body text-text-2"
			>
				Run in {tab.title}
			</label>
			<input
				id={inputId}
				// biome-ignore lint/a11y/noAutofocus: staging a command moves focus to the line that waits for Enter.
				autoFocus
				spellCheck={false}
				autoComplete="off"
				className="h-7 min-w-0 flex-1 bg-transparent font-mono text-mono text-text-1 outline-none"
				value={tab.draft}
				onChange={(e) => terminalStore.setDraft(tabId, e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						terminalStore.runDraft(tabId);
					} else if (e.key === "Escape") {
						e.preventDefault();
						terminalStore.setDraft(tabId, "");
					}
				}}
			/>
			<span className="hidden whitespace-nowrap text-meta text-text-3 md:inline">
				Enter runs it. Esc discards it.
			</span>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onClick={() => terminalStore.runDraft(tabId)}
			>
				Run
			</Button>
		</div>
	);
}

const UNAVAILABLE: Record<
	TerminalUnavailableReason,
	{ title: string; body: string }
> = {
	"not-host": {
		title: "The terminal opens only on the host",
		body: "This device is paired with the machine PrismaLens runs on. A terminal here would run commands on that machine, so PrismaLens opens one only in a browser or the desktop app on that machine itself. Every command in the app still has Copy, to run wherever you are signed in.",
	},
	"no-key": {
		title: "This browser can't open the terminal yet",
		body: "The terminal opens in the browser you started PrismaLens with, or in the desktop app. To use this browser, run this on the host and open the link it prints here:",
	},
	unsupported: {
		title: "The terminal isn't available on this machine",
		body: "PrismaLens couldn't load its terminal module here. Every command in the app still has Copy.",
	},
};

function Unavailable({ reason }: { reason: TerminalUnavailableReason }) {
	const copy = UNAVAILABLE[reason];
	return (
		<div
			className="grid flex-1 place-items-center p-6"
			data-testid={`terminal-${reason}`}
		>
			<div className="max-w-[31rem]">
				<h3 className="mb-1.5 font-semibold text-body text-text-1">
					{copy.title}
				</h3>
				<p className="mb-2.5 text-body text-text-2 leading-relaxed">
					{copy.body}
				</p>
				{reason === "no-key" ? (
					<CommandChip command="pl pair --operator" path className="mb-2.5" />
				) : null}
				<a
					className="text-accent text-body hover:underline"
					href={TERMINAL_DOCS_URL}
					target="_blank"
					rel="noreferrer"
				>
					How the terminal works
				</a>
			</div>
		</div>
	);
}
