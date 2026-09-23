// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateOwner } from "@/lib/api/hooks";

export interface SetupStepOwnerProps {
	onComplete: () => void;
	onError?: (error: string) => void;
}

export function SetupStepOwner({ onComplete, onError }: SetupStepOwnerProps) {
	// Track client-side mounting to avoid hydration mismatch from password manager extensions
	const [isMounted, setIsMounted] = useState(false);
	useEffect(() => {
		setIsMounted(true);
	}, []);

	const [error, setError] = useState<Error | null>(null);

	// Form state
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);

	// oRPC mutation for creating owner
	const createOwner = useCreateOwner();

	const validateForm = () => {
		if (!email) return "Email is required";
		if (password.length < 8) return "Password must be at least 8 characters";
		if (password !== confirmPassword) return "Passwords do not match";
		return null;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		const validationError = validateForm();
		if (validationError) {
			setError(new Error(validationError));
			onError?.(validationError);
			return;
		}

		try {
			await createOwner.mutateAsync({
				email,
				password,
				name: name || undefined,
			});
			onComplete();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "An unexpected error occurred";
			setError(new Error(message));
			onError?.(message);
		}
	};

	return (
		<div className="w-full max-w-sm" data-testid="setup-owner">
			<h1 className="text-xl font-semibold tracking-tight">
				Create the owner account
			</h1>
			<p className="mt-1 text-record text-muted-foreground">
				The only account on this PrismaLens. Sign-up closes after it.
			</p>

			<MutationError error={error} className="mt-4" />

			{/* Render form only after client mount to avoid hydration mismatch from password manager extensions */}
			{!isMounted ? (
				<div className="mt-5 space-y-3">
					{[1, 2, 3, 4].map((k) => (
						<div
							key={k}
							className="h-9 w-full animate-pulse rounded bg-muted"
						/>
					))}
				</div>
			) : (
				<form onSubmit={handleSubmit} className="mt-5 space-y-3">
					<div className="space-y-1">
						<Label htmlFor="name" className="text-meta">
							Name <span className="text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Your name"
							className="h-9 text-record"
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="email" className="text-meta">
							Email address
						</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="you@example.com"
							required
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
								placeholder="At least 8 characters"
								required
								minLength={8}
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
					<div className="space-y-1">
						<Label htmlFor="confirmPassword" className="text-meta">
							Confirm password
						</Label>
						<Input
							id="confirmPassword"
							type={showPassword ? "text" : "password"}
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							placeholder="Once more"
							required
							className="h-9 text-record"
						/>
					</div>
					<div className="pt-1">
						<Button
							type="submit"
							size="sm"
							className="h-8"
							disabled={createOwner.isPending}
						>
							{createOwner.isPending && (
								<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
							)}
							Create the owner account
						</Button>
					</div>
				</form>
			)}
		</div>
	);
}
