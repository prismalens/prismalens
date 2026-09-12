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
import { AlertTriangle, Frown, ServerOff } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
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
}catch(_){}})();`;

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "PrismaLens - AI-Powered Incident Analysis" },
			{
				name: "description",
				content:
					"Open-source AI-powered incident analysis and root cause detection",
			},
		],
		links: [{ rel: "stylesheet", href: appCss }],
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
						<div className="min-h-screen bg-background text-foreground">
							<Navbar />
							<main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
								<Outlet />
							</main>
						</div>
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
			<Frown className="h-16 w-16 text-muted-foreground" />
			<h1 className="text-4xl font-bold text-foreground">404</h1>
			<p className="text-xl text-muted-foreground">Page not found</p>
			<p className="text-muted-foreground text-center max-w-md">
				The page you're looking for doesn't exist or has been moved.
			</p>
			<Button asChild>
				<Link to="/">Go back home</Link>
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
				<body className="font-sans bg-background">
					<div className="flex min-h-screen flex-col items-center justify-center gap-4">
						<ServerOff className="h-16 w-16 text-destructive" />
						<h1 className="text-2xl font-bold text-foreground">
							Connection Error
						</h1>
						<p className="text-muted-foreground text-center max-w-md">
							Unable to connect to the PrismaLens API server. Please ensure the
							backend is running and try again.
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
			<body className="font-sans bg-background">
				<div className="flex min-h-screen flex-col items-center justify-center gap-4">
					<AlertTriangle className="h-16 w-16 text-destructive" />
					<h1 className="text-2xl font-bold text-foreground">
						Something went wrong
					</h1>
					<p className="text-muted-foreground">{getErrorMessage(error)}</p>
					<Button onClick={() => window.location.reload()}>Try again</Button>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
