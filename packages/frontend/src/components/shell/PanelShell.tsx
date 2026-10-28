// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	createContext,
	type KeyboardEvent,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
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
	right: RightMeta | null;
	bottom: BottomMeta | null;
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
function storage() {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

const SEPARATOR =
	"relative z-10 outline-none after:absolute after:bg-transparent after:transition-colors after:duration-(--dur-instant) data-[separator=hover]:after:bg-accent data-[separator=active]:after:bg-accent focus-visible:after:bg-accent";

export function PanelShell({ children }: { children: ReactNode }) {
	const [right, setRight] = useState<RightMeta | null>(null);
	const [bottom, setBottom] = useState<BottomMeta | null>(null);
	const [rightEl, setRightEl] = useState<HTMLElement | null>(null);
	const [bottomEl, setBottomEl] = useState<HTMLElement | null>(null);
	const phone = useMediaQuery(PHONE);
	const split = useMediaQuery(SPLIT_PANES);
	const beside = split && !!right;
	const below = !phone && !!bottom;

	const h = useDefaultLayout({
		id: `${STORAGE_PREFIX}.h`,
		panelIds: beside ? ["main", "right"] : ["main"],
		storage: storage(),
	});
	const v = useDefaultLayout({
		id: `${STORAGE_PREFIX}.v`,
		panelIds: below ? ["route", "bottom"] : ["route"],
		storage: storage(),
	});

	const floating = !!right && !split && !phone;
	const sheet = !!right && phone;
	const onPanelKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || e.defaultPrevented) return;
		e.preventDefault();
		right?.onClose();
	};

	// A floating panel or a sheet takes focus when it opens; the page that opened it returns focus on close.
	useEffect(() => {
		if ((floating || sheet) && rightEl) rightEl.focus({ preventScroll: true });
	}, [floating, sheet, rightEl]);

	return (
		<SlotsContext.Provider
			value={{ right, bottom, rightEl, bottomEl, setRight, setBottom }}
		>
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
									inert={sheet || undefined}
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
											ref={setBottomEl}
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
								ref={setRightEl}
								role="dialog"
								aria-modal="false"
								aria-label={right.label}
								tabIndex={-1}
								onKeyDown={onPanelKey}
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
									ref={setRightEl}
									aria-label={right.label}
									className="flex h-full min-h-0 flex-col bg-surface-1"
									data-testid="panel-right"
								/>
							</Panel>
						</>
					)}
				</Group>
			</div>
			{sheet &&
				createPortal(
					<div
						ref={setRightEl}
						role="dialog"
						aria-modal="true"
						aria-label={right.label}
						tabIndex={-1}
						onKeyDown={onPanelKey}
						className="fixed inset-0 z-50 flex flex-col bg-surface-1 pt-(--titlebar-h) outline-none"
						data-testid="panel-right"
					/>,
					document.body,
				)}
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
