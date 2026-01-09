/// <reference types="vite/client" />

import {
	createRootRoute,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { QueryProvider } from "@/lib/providers/query-provider";
import appCss from "../app.css?url";

export const Route = createRootRoute({
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
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="font-sans">
					<QueryProvider>
						<div className="min-h-screen bg-background">
							<Navbar />
							<main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
								<Outlet />
							</main>
						</div>
					</QueryProvider>
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16">
			<svg
				className="h-16 w-16 text-muted-foreground"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				aria-label="Page not found"
			>
				<title>Page not found</title>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={2}
					d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
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

function RootError({ error }: { error: Error }) {
	const isConnectionError =
		error.message.includes("fetch") ||
		error.message.includes("network") ||
		error.message.includes("ECONNREFUSED") ||
		error.name === "TypeError" ||
		error.name === "ConnectionError";

	if (isConnectionError) {
		return (
			<html lang="en">
				<head>
					<HeadContent />
				</head>
				<body className="font-sans bg-background">
					<div className="flex min-h-screen flex-col items-center justify-center gap-4">
						<svg
							className="h-16 w-16 text-destructive"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							aria-label="API Server Unreachable"
						>
							<title>API Server Unreachable</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
							/>
						</svg>
						<h1 className="text-2xl font-bold text-foreground">
							API Server Unreachable
						</h1>
						<p className="text-muted-foreground text-center max-w-md">
							Unable to connect to the PrismaLens API server. Please ensure the
							API is running.
						</p>
						<Button onClick={() => window.location.reload()}>Retry</Button>
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
					<svg
						className="h-16 w-16 text-destructive"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-label="Error"
					>
						<title>Error</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					<h1 className="text-2xl font-bold text-foreground">
						Something went wrong
					</h1>
					<p className="text-muted-foreground">{error.message}</p>
					<Button onClick={() => window.location.reload()}>Try again</Button>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
