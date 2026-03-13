/// <reference types="vite/client" />

import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AlertTriangle, Frown, ServerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/ui/toaster";
import { ConnectionError } from "@/lib/api/orpc-client";
import { ThemeProvider } from "@/lib/providers/theme-provider";
import { LanguageProvider } from "@/lib/providers/language-provider";
import { getThemeServerFn } from "@/lib/theme";
import { getLocaleServerFn } from "@/lib/locale";
import { queryClient, type RouterContext } from "@/router";
import * as m from "@/lib/paraglide/messages.js";
import appCss from "../app.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
	loader: async () => {
		const [theme, locale] = await Promise.all([
			getThemeServerFn(),
			getLocaleServerFn(),
		]);
		return { theme, locale };
	},
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
	}),
	component: RootLayout,
	errorComponent: RootError,
	notFoundComponent: NotFound,
});

function RootLayout() {
	const { theme, locale } = Route.useLoaderData();
	return (
		<html lang={locale} className={theme} suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="font-sans">
				<LanguageProvider locale={locale}>
					<ThemeProvider theme={theme}>
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
				</LanguageProvider>
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16">
			<Frown className="h-16 w-16 text-muted-foreground" />
			<h1 className="text-4xl font-bold text-foreground">
				{m.error_404_title()}
			</h1>
			<p className="text-xl text-muted-foreground">{m.error_404_subtitle()}</p>
			<p className="text-muted-foreground text-center max-w-md">
				{m.error_404_description()}
			</p>
			<Button asChild>
				<Link to="/">{m.error_404_go_home()}</Link>
			</Button>
		</div>
	);
}

function RootError({ error }: { error: Error }) {
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
							{m.error_connection_title()}
						</h1>
						<p className="text-muted-foreground text-center max-w-md">
							{m.error_connection_description()}
						</p>
						<Button onClick={() => window.location.reload()}>
							{m.error_try_again()}
						</Button>
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
						{m.error_generic_title()}
					</h1>
					<p className="text-muted-foreground">{error.message}</p>
					<Button onClick={() => window.location.reload()}>
						{m.error_try_again()}
					</Button>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
