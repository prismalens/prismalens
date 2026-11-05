// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useServices } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { useTheme } from "@/lib/providers/theme-provider";

const OPEN = "prismalens:search";
/** Opens the palette from a control; Ctrl+K and Cmd+K open it from anywhere. */
export const openSearch = () => window.dispatchEvent(new Event(OPEN));

const ROW = "mx-1.5 h-9 rounded-control px-3";

const PAGES = [
	{ to: "/threads", label: "Threads" },
	{ to: "/automation", label: "Automation" },
	{ to: "/incidents", label: "Operations" },
	{ to: "/alerts", label: "Operations › Alerts" },
	{ to: "/services", label: "Services" },
	{ to: "/schedules", label: "Automation › Schedules" },
	{ to: "/settings", label: "Settings" },
] as const;

/** One search over incidents (open and closed), services and pages. */
export function SearchPalette() {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			setOpen((v) => !v);
		};
		const onOpen = () => setOpen(true);
		window.addEventListener("keydown", onKey);
		window.addEventListener(OPEN, onOpen);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener(OPEN, onOpen);
		};
	}, []);
	const { bottomPanel, setBottomPanel } = useLayoutPrefs();
	const { theme, setTheme } = useTheme();
	const incidents = useQuery({
		...orpc.incidents.list.queryOptions({ input: { limit: 100 } }),
		enabled: open,
	});
	const services = useServices({ limit: 100 });
	const close = () => setOpen(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent
				className="overflow-hidden p-0"
				data-testid="search-palette"
			>
				<DialogTitle className="sr-only">Search</DialogTitle>
				<Command>
					<CommandInput placeholder="Search" data-testid="search-input" />
					<CommandList className="max-h-[50vh]">
						<CommandEmpty>Nothing matches.</CommandEmpty>
						{(incidents.data?.data.length ?? 0) > 0 && (
							<CommandGroup heading="Incidents">
								{incidents.data?.data.map((i) => (
									<CommandItem
										className={ROW}
										key={i.id}
										value={`INC-${i.number} ${i.title}`}
										onSelect={() => {
											close();
											void navigate({
												to: "/incidents/$id",
												params: { id: i.id },
											});
										}}
										data-testid="search-incident"
									>
										<span className="font-mono text-text-3">
											INC-{i.number}
										</span>
										<span className="truncate">{i.title}</span>
									</CommandItem>
								))}
							</CommandGroup>
						)}
						{(services.data?.data.length ?? 0) > 0 && (
							<CommandGroup heading="Services">
								{services.data?.data.map((s) => (
									<CommandItem
										className={ROW}
										key={s.id}
										value={`service ${s.name}`}
										onSelect={() => {
											close();
											void navigate({
												to: "/services/$id",
												params: { id: s.id },
											});
										}}
									>
										{s.name}
									</CommandItem>
								))}
							</CommandGroup>
						)}
						<CommandGroup heading="Actions">
							<CommandItem
								className={ROW}
								value="action terminal"
								onSelect={() => {
									close();
									setBottomPanel(!bottomPanel);
								}}
								data-testid="search-terminal"
							>
								{bottomPanel ? "Hide the terminal" : "Show the terminal"}
							</CommandItem>
							<CommandItem
								className={ROW}
								value="action theme light dark"
								onSelect={() => {
									close();
									setTheme(theme === "dark" ? "light" : "dark");
								}}
								data-testid="search-theme"
							>
								{theme === "dark"
									? "Use the light theme"
									: "Use the dark theme"}
							</CommandItem>
						</CommandGroup>
						<CommandGroup heading="Go to">
							{PAGES.map((p) => (
								<CommandItem
									className={ROW}
									key={p.to}
									value={`page ${p.label}`}
									onSelect={() => {
										close();
										void navigate({ to: p.to });
									}}
								>
									{p.label}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
