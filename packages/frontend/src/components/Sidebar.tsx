// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The shell's left rail: the three front doors with what waits behind each,
 * the theme and the account at the bottom. Hidden on setup and auth routes so
 * nothing leads away from a step that must finish. On narrow screens it folds
 * to a top strip.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Bell, Layers, LogOut, Settings, Siren } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { orpc } from "@/lib/api/orpc-client";
import { signOut, useSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function Sidebar() {
	const location = useLocation();
	if (
		location.pathname.startsWith("/setup") ||
		location.pathname.startsWith("/auth")
	) {
		return null;
	}
	return <SidebarBody pathname={location.pathname} />;
}

function SidebarBody({ pathname }: { pathname: string }) {
	const { data: session } = useSession();
	const signedIn = !!session?.user;
	const incidents = useQuery({
		...orpc.incidents.getStats.queryOptions({ input: {} }),
		enabled: signedIn,
		refetchInterval: 30_000,
	});
	const alerts = useQuery({
		...orpc.alerts.getStats.queryOptions({ input: {} }),
		enabled: signedIn,
		refetchInterval: 30_000,
	});
	const needsYou = incidents.data
		? incidents.data.attention.failed_run +
			incidents.data.attention.unacknowledged +
			incidents.data.attention.awaiting_close
		: 0;
	const firing = alerts.data?.byStatus.triggered ?? 0;

	const items: {
		to: "/incidents" | "/alerts" | "/settings";
		label: string;
		icon: ReactNode;
		count?: number;
		countTone?: "critical" | "neutral";
	}[] = [
		{
			to: "/incidents",
			label: "Incidents",
			icon: <Siren className="h-4 w-4" />,
			count: needsYou || undefined,
			countTone: "critical",
		},
		{
			to: "/alerts",
			label: "Alerts",
			icon: <Bell className="h-4 w-4" />,
			count: firing || undefined,
			countTone: "neutral",
		},
		{
			to: "/settings",
			label: "Settings",
			icon: <Settings className="h-4 w-4" />,
		},
	];

	const nav = (compact: boolean) =>
		items.map((item) => {
			const active = pathname.startsWith(item.to);
			return (
				<Link
					key={item.to}
					to={item.to}
					aria-current={active ? "page" : undefined}
					className={cn(
						"flex items-center gap-2.5 rounded-md px-2 py-1.5 text-record text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
						active && "bg-muted text-foreground",
						compact && "py-1",
					)}
					data-testid={`nav-${item.label.toLowerCase()}`}
				>
					{item.icon}
					<span className="flex-1">{item.label}</span>
					{item.count !== undefined && (
						<span
							className={cn(
								"min-w-5 rounded px-1 text-center text-meta font-medium tabular-nums",
								item.countTone === "critical"
									? "bg-sev-critical/15 text-sev-critical"
									: "bg-muted-foreground/15 text-muted-foreground",
							)}
						>
							{item.count}
						</span>
					)}
				</Link>
			);
		});

	return (
		<>
			<aside
				className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r bg-card md:flex"
				data-testid="sidebar"
			>
				<Link
					to="/incidents"
					className="flex items-center gap-2 px-3 py-3 text-sm font-semibold tracking-tight"
				>
					<span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
						<Layers className="h-3.5 w-3.5" />
					</span>
					PrismaLens
				</Link>
				<nav className="flex flex-col gap-0.5 px-2">{nav(false)}</nav>
				<div className="mt-auto flex items-center justify-between border-t px-2 py-2">
					<ThemeToggle />
					<UserMenu />
				</div>
			</aside>

			<div
				className="flex items-center gap-1 border-b bg-card px-2 py-1 md:hidden"
				data-testid="topbar"
			>
				<Link to="/incidents" className="px-2 text-sm font-semibold">
					PrismaLens
				</Link>
				<nav className="flex flex-1 items-center gap-0.5">{nav(true)}</nav>
				<ThemeToggle />
				<UserMenu />
			</div>
		</>
	);
}

function getInitials(name: string | null | undefined): string {
	if (!name) return "?";
	return name
		.split(" ")
		.map((part) => part[0])
		.filter(Boolean)
		.slice(0, 2)
		.join("")
		.toUpperCase();
}

function UserMenu() {
	const { data: session } = useSession();
	const navigate = useNavigate();
	if (!session?.user) return null;
	const { user } = session;
	const handleSignOut = async () => {
		await signOut();
		navigate({ to: "/auth/login", search: { redirect: undefined } });
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 rounded-full"
					aria-label="User menu"
				>
					<Avatar className="h-7 w-7">
						<AvatarFallback className="bg-primary text-primary-foreground text-xs">
							{getInitials(user.name)}
						</AvatarFallback>
					</Avatar>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel className="font-normal">
					<div className="flex flex-col space-y-1">
						<p className="text-sm font-medium leading-none">{user.name}</p>
						<p className="text-xs leading-none text-muted-foreground">
							{user.email}
						</p>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
					<LogOut className="mr-2 h-4 w-4" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
