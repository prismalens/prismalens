// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { Palette } from "@/components/shell/Palette";
import {
	DIALOG_WIDTH,
	Dialog,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAppCommand } from "@/lib/app-commands";
import { matches, runActionKey } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

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
	useAppCommand("search", () => setOpen(true), enabled);
	useAppCommand("newThread", () => void navigate({ to: "/new" }), enabled);
	useEffect(() => {
		if (!enabled) return;
		const onKey = (e: KeyboardEvent) => {
			if (matches(e, "app.search")) {
				e.preventDefault();
				setOpen(true);
			} else if (matches(e, "app.newThread")) {
				e.preventDefault();
				void navigate({ to: "/new" });
			} else if (runActionKey(e)) {
				e.preventDefault();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [navigate, enabled]);
	return (
		<OpenSearch.Provider value={() => setOpen(true)}>
			{children}
			{enabled && <ThreadSearch open={open} onOpenChange={setOpen} />}
		</OpenSearch.Provider>
	);
}

/** The Ctrl K palette (#1101 category 19); its body is `Palette`. */
export function ThreadSearch({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				fit
				className={cn(DIALOG_WIDTH.lg, "gap-0 p-0 sm:max-w-[640px]")}
				data-testid="thread-search"
			>
				<DialogTitle className="sr-only">Search</DialogTitle>
				{open && <Palette onDone={() => onOpenChange(false)} />}
			</DialogContent>
		</Dialog>
	);
}
