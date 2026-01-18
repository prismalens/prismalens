"use client";

import { useState, useEffect } from "react";
import {
	AlertCircle,
	ArrowRight,
	Eye,
	EyeOff,
	Loader2,
	Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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

	const [error, setError] = useState<string | null>(null);

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
			setError(validationError);
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
			setError(message);
			onError?.(message);
		}
	};

	return (
		<Card>
			<CardHeader className="text-center">
				<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
					<Shield className="h-8 w-8 text-primary" />
				</div>
				<CardTitle>Welcome to PrismaLens</CardTitle>
				<CardDescription>
					Create your administrator account to get started
				</CardDescription>
			</CardHeader>
			<CardContent>
				{error && (
					<div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
						<AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
						<p className="text-sm text-destructive">{error}</p>
					</div>
				)}

				{/* Render form only after client mount to avoid hydration mismatch from password manager extensions */}
				{!isMounted ? (
					<div className="space-y-4">
						<div className="space-y-2">
							<div className="h-4 w-16 bg-muted rounded animate-pulse" />
							<div className="h-10 w-full bg-muted rounded animate-pulse" />
						</div>
						<div className="space-y-2">
							<div className="h-4 w-24 bg-muted rounded animate-pulse" />
							<div className="h-10 w-full bg-muted rounded animate-pulse" />
						</div>
						<div className="space-y-2">
							<div className="h-4 w-20 bg-muted rounded animate-pulse" />
							<div className="h-10 w-full bg-muted rounded animate-pulse" />
						</div>
						<div className="space-y-2">
							<div className="h-4 w-32 bg-muted rounded animate-pulse" />
							<div className="h-10 w-full bg-muted rounded animate-pulse" />
						</div>
						<div className="h-10 w-full bg-muted rounded animate-pulse" />
					</div>
				) : (
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">
								Name <span className="text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Your name"
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="email">Email address</Label>
							<Input
								id="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="admin@example.com"
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<div className="relative">
								<Input
									id="password"
									type={showPassword ? "text" : "password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="At least 8 characters"
									required
									minLength={8}
									className="pr-10"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								>
									{showPassword ? (
										<EyeOff className="h-4 w-4" />
									) : (
										<Eye className="h-4 w-4" />
									)}
								</button>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="confirmPassword">Confirm Password</Label>
							<Input
								id="confirmPassword"
								type={showPassword ? "text" : "password"}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								placeholder="Confirm your password"
								required
							/>
						</div>

						<Button type="submit" className="w-full" disabled={createOwner.isPending}>
							{createOwner.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Creating account...
								</>
							) : (
								<>
									Create Account
									<ArrowRight className="ml-2 h-4 w-4" />
								</>
							)}
						</Button>
					</form>
				)}

				<div className="mt-6 p-4 bg-muted/50 rounded-lg">
					<p className="text-sm text-muted-foreground">
						This account will have full administrative access to PrismaLens. You
						can invite team members later.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
