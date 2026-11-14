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
	const held = useRef<Held>({ take: () => "" });
	const stopHolding = useRef<() => void>(() => {});
	const openSearch = () => {
		stopHolding.current();
		const hold = holdKeys();
		held.current = hold;
		stopHolding.current = hold.stop;
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
					takeTyped={() => held.current.take()}
				/>
			)}
		</OpenSearch.Provider>
	);
}

/**
 * The palette loads on its first open, so keys typed right after Ctrl K had nowhere to go:
 * they landed in the box that had focus (and synced as its draft). An unseen field takes
 * them until the palette's input has focus; they become its first query (#1101 category 7).
 * A field, not a key listener: plain-key shortcuts already wait while a field has focus.
 */
interface Held {
	/** The keys so far, cleared as they are taken. */
	take: () => string;
	stop?: () => void;
}

function holdKeys(): Required<Held> {
	const field = document.createElement("input");
	field.setAttribute("aria-hidden", "true");
	field.tabIndex = -1;
	field.style.cssText =
		"position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
	document.body.append(field);
	field.focus({ preventScroll: true });
	// Nothing holds keys for long: a palette that never loads gives the keyboard back.
	const giveUp = setTimeout(() => stop(), 15_000);
	const stop = () => {
		clearTimeout(giveUp);
		field.remove();
	};
	// The palette's input took focus: from here the keys are its own.
	field.addEventListener("blur", stop);
	const take = () => {
		const t = field.value;
		field.value = "";
		return t;
	};
	return { take, stop };
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
