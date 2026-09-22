// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { operatorQueryOptions } from "@/hooks/use-operator";
import { signIn } from "@/lib/auth";

function isValidRedirect(path: unknown): path is string {
	if (typeof path !== "string") return false;
	return (
		path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")
	);
}

export const Route = createFileRoute("/auth/login")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: isValidRedirect(search.redirect) ? search.redirect : undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		// Already the operator (a session, or the host itself): nothing to sign
		// in to.
		const whoami = await context.queryClient.ensureQueryData(
			operatorQueryOptions(),
		);
		if (whoami.via) {
			const safePath = isValidRedirect(search.redirect) ? search.redirect : "/";
			throw redirect({ to: safePath });
		}
	},
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { redirect: redirectTo } = Route.useSearch();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		try {
			const result = await signIn.email({
				email,
				password,
			});

			if (result.error) {
				setError(
					new Error(result.error.message || "Invalid email or password"),
				);
				return;
			}

			// Invalidate session cache so _authenticated beforeLoad gets the fresh session
			// The gate caches "who am I" for a minute; a fresh session must not
			// answer from that cache or the browser bounces back here.
			await queryClient.invalidateQueries({
				queryKey: operatorQueryOptions().queryKey,
			});

			// Redirect to original page or dashboard on success
			// Only allow same-origin relative paths to prevent open redirect
			const safePath = isValidRedirect(redirectTo) ? redirectTo : "/";
			navigate({ to: safePath });
		} catch {
			setError(new Error("An unexpected error occurred. Please try again."));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex min-h-[80vh] items-center justify-center px-4">
			<div className="w-full max-w-sm" data-testid="login">
				<h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
				<p className="mt-1 text-record text-muted-foreground">
					The owner account for this PrismaLens.
				</p>

				<MutationError error={error} className="mt-4" />

				<form onSubmit={handleSubmit} className="mt-5 space-y-3">
					<div className="space-y-1">
						<Label htmlFor="email" className="text-meta">
							Email address
						</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							autoComplete="email"
							placeholder="you@example.com"
							className="h-9 text-record"
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="password" className="text-meta">
							Password
						</Label>
						<div className="relative">
							<Input
								id="password"
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="current-password"
								placeholder="Your password"
								className="h-9 pr-9 text-record"
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => setShowPassword(!showPassword)}
								className="absolute right-0 top-0 h-9 w-9 hover:bg-transparent"
								aria-label={showPassword ? "Hide password" : "Show password"}
							>
								{showPassword ? (
									<EyeOff className="h-4 w-4 text-muted-foreground" />
								) : (
									<Eye className="h-4 w-4 text-muted-foreground" />
								)}
							</Button>
						</div>
					</div>
					<div className="pt-1">
						<Button
							type="submit"
							size="sm"
							className="h-8"
							disabled={isLoading}
						>
							{isLoading && (
								<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
							)}
							Sign in
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
