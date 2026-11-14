// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	DIALOG_WIDTH,
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { listenKeys } from "@/hooks/use-global-shortcuts";
import { useAppCommand } from "@/lib/app-commands";
import { lazyPart } from "@/lib/lazy";
import { cn } from "@/lib/utils";

/** The palette and its command list load on the first Ctrl K, not with the sidebar (#1101 category 12). */
const Palette = lazyPart(() =>
	import("@/components/shell/Palette").then((m) => m.Palette),
);

const OpenSearch = createContext<() => void>(() => {});

/** Opens the Search palette from anywhere inside `SearchHost`. */
export const useOpenSearch = () => useContext(OpenSearch);

/**
 * Holds Search and its shortcuts (Ctrl K, Ctrl Shift O for New thread) for the
 * whole shell, so they work with the sidebar hidden, on Settings and on a phone.
 */
export function SearchHost({
	enabled,
	children,
}: {
	enabled: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const typed = useRef("");
	const stopHolding = useRef<() => void>(() => {});
	const openSearch = () => {
		stopHolding.current();
		stopHolding.current = holdKeys(typed);
		setOpen(true);
	};
	const onOpenChange = (next: boolean) => {
		if (!next) stopHolding.current();
		setOpen(next);
	};
	useEffect(() => () => stopHolding.current(), []);
	useAppCommand("search", openSearch, enabled);
	useAppCommand("newThread", () => void navigate({ to: "/new" }), enabled);
	return (
		<OpenSearch.Provider value={openSearch}>
			{children}
			{enabled && (
				<ThreadSearch
					open={open}
					onOpenChange={onOpenChange}
					takeTyped={() => {
						const t = typed.current;
						typed.current = "";
						return t;
					}}
				/>
			)}
		</OpenSearch.Provider>
	);
}

const INPUT = '[data-testid="thread-search-input"]';

/**
 * The palette loads on its first open, so keys typed right after Ctrl K have nowhere to go:
 * they would land in the box that had focus (and sync as its draft). They are held here
 * until the palette's input has focus, and become its first query (#1101 category 7).
 */
function holdKeys(typed: { current: string }): () => void {
	typed.current = "";
	const had = document.activeElement;
	if (had instanceof HTMLElement && !had.matches(INPUT)) had.blur();
	const onKey = (e: KeyboardEvent) => {
		if (document.activeElement?.matches(INPUT) || e.key === "Escape") {
			stop();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
		if (e.key.length === 1) typed.current += e.key;
		else if (e.key === "Backspace") typed.current = typed.current.slice(0, -1);
		else return;
		e.preventDefault();
		e.stopPropagation();
	};
	// Nothing holds keys for long: a palette that never loads gives the keyboard back.
	const giveUp = setTimeout(() => stop(), 15_000);
	const off = listenKeys(onKey, { target: document, capture: true });
	const stop = () => {
		clearTimeout(giveUp);
		off();
	};
	return stop;
}

/** The Ctrl K palette (#1101 category 19); its body is `Palette`. */
export function ThreadSearch({
	open,
	onOpenChange,
	takeTyped,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Keys typed before the palette could take them: its first query. */
	takeTyped?: () => string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				fit
				className={cn(DIALOG_WIDTH.lg, "gap-0 p-0 sm:max-w-[640px]")}
				data-testid="thread-search"
				// The body loads on the first Ctrl K, so the dialog's own first focus would land on
				// Close; the input takes focus when it mounts (`autoFocus` in `Palette`).
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<DialogTitle className="sr-only">Search</DialogTitle>
				{open && (
					<Palette onDone={() => onOpenChange(false)} takeTyped={takeTyped} />
				)}
			</DialogContent>
		</Dialog>
	);
}
