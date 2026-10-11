// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/// <reference types="vite/client" />

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { AlertTriangle, ServerOff } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { NewIncidentProvider } from "@/components/shell/NewIncident";
import { ReconnectLine } from "@/components/shell/ReconnectLine";
import { TitleBarStrip } from "@/components/TitleBarStrip";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionError } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { ThemeProvider } from "@/lib/providers/theme-provider";
import { DEFAULT_THEME, THEME_COOKIE } from "@/lib/theme";
import { queryClient, type RouterContext } from "@/router";
import appCss from "../app.css?url";

/**
 * Pre-paint theme stamp.
 *
 * The app ships as a static SPA (`pl up`, issue #237): the HTML that reaches
 * the browser is a prerendered shell that knows nothing about this visitor's
 * cookies, and React only runs once it has parsed. This inline script runs
 * FIRST and writes `<html class>` from the cookie — the whole job the deleted
 * `getThemeServerFn` was doing. Without it, every load flashes the default
 * theme before React corrects it.
 */
const PRE_PAINT = `(function(){try{
var g=function(n){var m=document.cookie.match(new RegExp('(^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[2]):null;};
var e=document.documentElement;
var t=g(${JSON.stringify(THEME_COOKIE)})==='light'?'light':${JSON.stringify(DEFAULT_THEME)};
e.classList.remove('light','dark');e.classList.add(t);
var d=window.prismalensDesktop;if(d)e.setAttribute('data-desktop',d.platform);
try{if(JSON.parse(localStorage.getItem('pl.layout')||'{}').sidebarFolded){e.setAttribute('data-sidebar-folded','');}}catch(_){}
if(location.pathname.indexOf('/settings')===0)e.setAttribute('data-settings','');
}catch(_){}})();`;

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "PrismaLens" },
			{
				name: "description",
				content:
					"Open-source AI-powered incident analysis and root cause detection",
			},
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
		],
		// The head function's `scripts` key is what router-core maps onto the
		// match's `headScripts`, i.e. this renders INSIDE <head>. A raw <script>
		// written into the JSX <head> is not an option: TanStack Start renders
		// the head through `HeadContent` and silently drops anything else there,
		// which is exactly how the first attempt vanished from the shell.
		scripts: [{ children: PRE_PAINT }],
	}),
	component: RootLayout,
	errorComponent: RootError,
	notFoundComponent: NotFound,
});

function RootLayout() {
	return (
		<html lang="en" className={DEFAULT_THEME} suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="font-sans">
				<ThemeProvider>
					<QueryClientProvider client={queryClient}>
						<TooltipProvider delayDuration={400} skipDelayDuration={200}>
							<NewIncidentProvider>
								<div className="min-h-dvh bg-canvas text-text-1">
									<Sidebar />
									<main className="min-w-0 pt-(--titlebar-h) md:pl-(--sidebar-w)">
										<ReconnectLine />
										<div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
											<Outlet />
										</div>
									</main>
								</div>
							</NewIncidentProvider>
						</TooltipProvider>
						<Toaster />
						<ReactQueryDevtools initialIsOpen={false} />
					</QueryClientProvider>
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16">
			<TitleBarStrip />
			<h1 className="text-display">Nothing here</h1>
			<p className="max-w-md text-center text-body text-text-2">
				This address does not match a page. It may have moved.
			</p>
			<Button asChild>
				<Link to="/">Open the inbox</Link>
			</Button>
		</div>
	);
}

function RootError({ error }: ErrorComponentProps) {
	const isConnectionError = error instanceof ConnectionError;

	if (isConnectionError) {
		return (
			<html lang="en">
				<head>
					<HeadContent />
				</head>
				<body className="bg-canvas font-sans">
					<TitleBarStrip />
					<div className="flex min-h-screen flex-col items-center justify-center gap-4">
						<ServerOff className="size-6 text-danger" />
						<h1 className="text-title">PrismaLens is not answering</h1>
						<p className="max-w-md text-center text-body text-text-2">
							The page could not reach the PrismaLens server. Check that it is
							running, then try again.
						</p>
						<Button onClick={() => window.location.reload()}>Try again</Button>
					</div>
					<Scripts />
				</body>
			</html>
		);
	}

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-canvas font-sans">
				<TitleBarStrip />
				<div className="flex min-h-screen flex-col items-center justify-center gap-4">
					<AlertTriangle className="size-6 text-danger" />
					<h1 className="text-title">Something went wrong</h1>
					<p className="text-body text-text-2">{getErrorMessage(error)}</p>
					<Button onClick={() => window.location.reload()}>Try again</Button>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
