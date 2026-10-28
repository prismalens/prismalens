// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	Group,
	Panel,
	Separator,
	useDefaultLayout,
} from "react-resizable-panels";
import { PHONE, SPLIT_PANES, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * The frame every authenticated page sits in (#973): the page, a right panel
 * beside it and a bottom panel under it. A page contributes a panel by
 * rendering `<RightPanel>` or `<BottomPanel>`; the shell draws the region and
 * portals the content in, so a page keeps its own state.
 */

interface RightMeta {
	label: string;
	onClose: () => void;
}
interface BottomMeta {
	label: string;
}
interface Slots {
	/** One element per panel for the shell's life: moving it between regions never remounts what a page put in it. */
	rightEl: HTMLElement | null;
	bottomEl: HTMLElement | null;
	setRight: (m: RightMeta | null) => void;
	setBottom: (m: BottomMeta | null) => void;
}

const SlotsContext = createContext<Slots | null>(null);

function useSlots(): Slots {
	const slots = useContext(SlotsContext);
	if (!slots) throw new Error("A panel must render inside PanelShell");
	return slots;
}

// One storage key per group; the library keeps each set of panels' layout apart.
const STORAGE_PREFIX = "pl.panels";
// Storage can be absent or throw (a private window, a policy); sizes then last for the page only.
const memory = new Map<string, string>();
const storage = {
	getItem(key: string) {
		try {
			return window.localStorage.getItem(key);
		} catch {
			return memory.get(key) ?? null;
		}
	},
	setItem(key: string, value: string) {
		try {
			window.localStorage.setItem(key, value);
		} catch {
			memory.set(key, value);
		}
	},
};

function slotElement() {
	if (typeof document === "undefined") return null;
	const el = document.createElement("div");
	el.className = "flex h-full min-h-0 flex-col";
	return el;
}

/** Keeps `el` inside whichever region currently shows it, and focus where it was inside it. */
function useMount(host: HTMLElement | null, el: HTMLElement | null) {
	const last = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!el) return;
		const into = (e: FocusEvent) => {
			last.current = e.target as HTMLElement;
		};
		const out = (e: FocusEvent) => {
			const to = e.relatedTarget as Node | null;
			if (to && !el.contains(to)) last.current = null;
		};
		el.addEventListener("focusin", into);
		el.addEventListener("focusout", out);
		return () => {
			el.removeEventListener("focusin", into);
			el.removeEventListener("focusout", out);
		};
	}, [el]);
	useLayoutEffect(() => {
		if (!host || !el || el.parentElement === host) return;
		const had = last.current;
		host.append(el);
		if (had && el.contains(had)) had.focus({ preventScroll: true });
	}, [host, el]);
}

const SEPARATOR =
	"relative z-10 outline-none after:absolute after:bg-transparent after:transition-colors after:duration-(--dur-instant) data-[separator=hover]:after:bg-accent data-[separator=active]:after:bg-accent focus-visible:after:bg-accent";

export function PanelShell({ children }: { children: ReactNode }) {
	const [right, setRight] = useState<RightMeta | null>(null);
	const [bottom, setBottom] = useState<BottomMeta | null>(null);
	const [rightEl] = useState(slotElement);
	const [bottomEl] = useState(slotElement);
	const [rightHost, setRightHost] = useState<HTMLElement | null>(null);
	const [bottomHost, setBottomHost] = useState<HTMLElement | null>(null);
	useMount(rightHost, rightEl);
	useMount(bottomHost, bottomEl);
	const phone = useMediaQuery(PHONE);
	const split = useMediaQuery(SPLIT_PANES);
	const beside = split && !!right;
	const below = !phone && !!bottom;

	const h = useDefaultLayout({
		id: `${STORAGE_PREFIX}.h`,
		panelIds: beside ? ["main", "right"] : ["main"],
		storage,
	});
	const v = useDefaultLayout({
		id: `${STORAGE_PREFIX}.v`,
		panelIds: below ? ["route", "bottom"] : ["route"],
		storage,
	});

	const floating = !!right && !split && !phone;
	const sheet = !!right && phone;
	const onClose = right?.onClose;

	// Escape closes a floating panel (the sheet's dialog has its own). A DOM listener, because the
	// content is portalled from the page: React would bubble its keys through the page (#974 OBJ-013).
	useEffect(() => {
		if (!rightHost || !onClose || !floating) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			e.preventDefault();
			onClose();
		};
		rightHost.addEventListener("keydown", onKey);
		return () => rightHost.removeEventListener("keydown", onKey);
	}, [rightHost, onClose, floating]);

	// A floating panel takes focus when it opens; the page that opened it returns focus on close.
	useEffect(() => {
		if (floating && rightHost && !rightHost.contains(document.activeElement))
			rightHost.focus({ preventScroll: true });
	}, [floating, rightHost]);

	return (
		<SlotsContext.Provider value={{ rightEl, bottomEl, setRight, setBottom }}>
			<div
				className="fixed inset-x-0 bottom-0 top-(--frame-top) bg-canvas md:left-(--sidebar-w)"
				data-testid="shell-frame"
			>
				<Group
					orientation="horizontal"
					defaultLayout={h.defaultLayout}
					onLayoutChanged={h.onLayoutChanged}
					className="h-full"
				>
					<Panel id="main" minSize="360px" className="relative">
						<Group
							orientation="vertical"
							defaultLayout={v.defaultLayout}
							onLayoutChanged={v.onLayoutChanged}
							className="h-full"
						>
							<Panel id="route" minSize="160px">
								<div
									className="h-full min-h-0 min-w-0"
									data-testid="shell-route"
								>
									{children}
								</div>
							</Panel>
							{below && (
								<>
									<Separator
										id="panel-bottom-separator"
										aria-label={`Resize ${bottom.label}`}
										className={cn(
											SEPARATOR,
											"h-px bg-hairline after:inset-x-0 after:-top-0.5 after:h-1",
										)}
									/>
									<Panel
										id="bottom"
										defaultSize="240px"
										minSize="120px"
										maxSize="70%"
									>
										<section
											ref={setBottomHost}
											aria-label={bottom.label}
											className="flex h-full min-h-0 flex-col bg-surface-1"
											data-testid="panel-bottom"
										/>
									</Panel>
								</>
							)}
						</Group>
						{floating && (
							<div
								ref={setRightHost}
								role="dialog"
								aria-modal="false"
								aria-label={right.label}
								tabIndex={-1}
								className="absolute top-2 right-2 bottom-2 z-20 flex w-[min(30rem,calc(100%-4rem))] flex-col overflow-hidden rounded-pool bg-surface-1 shadow-float outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200"
								data-testid="panel-right"
							/>
						)}
					</Panel>
					{beside && (
						<>
							<Separator
								id="panel-right-separator"
								aria-label={`Resize ${right.label}`}
								className={cn(
									SEPARATOR,
									"w-px bg-hairline after:inset-y-0 after:-left-0.5 after:w-1",
								)}
							/>
							<Panel
								id="right"
								defaultSize="420px"
								minSize="320px"
								maxSize="70%"
							>
								<section
									ref={setRightHost}
									aria-label={right.label}
									className="flex h-full min-h-0 flex-col bg-surface-1"
									data-testid="panel-right"
								/>
							</Panel>
						</>
					)}
				</Group>
			</div>
			{/* A phone's sheet is the app's modal dialog: focus stays in it, the rest is hidden from
			    assistive tech, and later dialogs and toasts layer over it (#974 OBJ-014, OBJ-015). */}
			<DialogPrimitive.Root
				open={sheet}
				onOpenChange={(open) => {
					if (!open) right?.onClose();
				}}
			>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Content
						ref={setRightHost}
						aria-describedby={undefined}
						onCloseAutoFocus={(e) => e.preventDefault()}
						className="fixed inset-0 z-50 flex flex-col bg-surface-1 pt-(--titlebar-h) outline-none"
						data-testid="panel-right"
					>
						<DialogPrimitive.Title className="sr-only">
							{right?.label}
						</DialogPrimitive.Title>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</SlotsContext.Provider>
	);
}

/**
 * A page's right-panel content. Beside the page from 1024 px, floating over
 * it below that, a full-screen sheet on a phone; Escape closes the last two.
 */
export function RightPanel({
	open,
	label,
	onClose,
	children,
}: {
	open: boolean;
	label: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const { setRight, rightEl } = useSlots();
	useLayoutEffect(() => {
		setRight(open ? { label, onClose } : null);
	}, [open, label, onClose, setRight]);
	useLayoutEffect(() => () => setRight(null), [setRight]);
	// Portalled whenever open, into the one element the shell moves between regions.
	return open && rightEl ? createPortal(children, rightEl) : null;
}

/** A page's bottom-panel content, under the page; a phone gets none (#931). */
export function BottomPanel({
	open,
	label,
	children,
}: {
	open: boolean;
	label: string;
	children: ReactNode;
}) {
	const { setBottom, bottomEl } = useSlots();
	const phone = useMediaQuery(PHONE);
	const shown = open && !phone;
	useLayoutEffect(() => {
		setBottom(shown ? { label } : null);
	}, [shown, label, setBottom]);
	useLayoutEffect(() => () => setBottom(null), [setBottom]);
	return shown && bottomEl ? createPortal(children, bottomEl) : null;
}
