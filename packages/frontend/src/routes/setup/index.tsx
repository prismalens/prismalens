import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2, Shield } from "lucide-react";

export const Route = createFileRoute("/setup/")({
	component: SetupPage,
});

function SetupPage() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [name, setName] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isComplete, setIsComplete] = useState(false);

	const validatePassword = () => {
		if (password.length < 8) {
			return "Password must be at least 8 characters";
		}
		if (password !== confirmPassword) {
			return "Passwords do not match";
		}
		return null;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		const passwordError = validatePassword();
		if (passwordError) {
			setError(passwordError);
			return;
		}

		setIsLoading(true);

		try {
			const response = await fetch("/api/users/setup", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email,
					password,
					name: name || undefined,
				}),
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.message || "Failed to create account");
			}

			setIsComplete(true);

			// Auto-redirect to login after 2 seconds
			setTimeout(() => {
				navigate({ to: "/auth/login" });
			}, 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	if (isComplete) {
		return (
			<div className="min-h-[80vh] flex items-center justify-center">
				<div className="w-full max-w-md">
					<div className="bg-card border border-border rounded-lg shadow-lg p-8 text-center">
						<div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
							<CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
						</div>
						<h1 className="text-2xl font-bold text-foreground mb-2">
							Setup Complete!
						</h1>
						<p className="text-muted-foreground mb-6">
							Your admin account has been created. Redirecting to login...
						</p>
						<Button onClick={() => navigate({ to: "/auth/login" })}>
							Go to Login
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-[80vh] flex items-center justify-center">
			<div className="w-full max-w-md">
				<div className="bg-card border border-border rounded-lg shadow-lg p-8">
					{/* Header */}
					<div className="text-center mb-8">
						<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
							<Shield className="h-8 w-8 text-primary" />
						</div>
						<h1 className="text-2xl font-bold text-foreground">
							Welcome to PrismaLens
						</h1>
						<p className="text-muted-foreground mt-2">
							Create your admin account to get started
						</p>
					</div>

					{/* Error Alert */}
					{error && (
						<div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
							<AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
							<p className="text-sm text-destructive">{error}</p>
						</div>
					)}

					{/* Setup Form */}
					<form onSubmit={handleSubmit} className="space-y-5">
						<div>
							<label
								htmlFor="name"
								className="block text-sm font-medium text-foreground mb-2"
							>
								Name <span className="text-muted-foreground">(optional)</span>
							</label>
							<input
								id="name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								autoComplete="name"
								className="w-full px-4 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
								placeholder="Your name"
							/>
						</div>

						<div>
							<label
								htmlFor="email"
								className="block text-sm font-medium text-foreground mb-2"
							>
								Email address
							</label>
							<input
								id="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoComplete="email"
								className="w-full px-4 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
								placeholder="admin@example.com"
							/>
						</div>

						<div>
							<label
								htmlFor="password"
								className="block text-sm font-medium text-foreground mb-2"
							>
								Password
							</label>
							<div className="relative">
								<input
									id="password"
									type={showPassword ? "text" : "password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									minLength={8}
									autoComplete="new-password"
									className="w-full px-4 py-2 pr-10 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
									placeholder="At least 8 characters"
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

						<div>
							<label
								htmlFor="confirmPassword"
								className="block text-sm font-medium text-foreground mb-2"
							>
								Confirm Password
							</label>
							<input
								id="confirmPassword"
								type={showPassword ? "text" : "password"}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								required
								autoComplete="new-password"
								className="w-full px-4 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
								placeholder="Confirm your password"
							/>
						</div>

						<Button
							type="submit"
							className="w-full"
							disabled={isLoading}
						>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Creating account...
								</>
							) : (
								"Create Admin Account"
							)}
						</Button>
					</form>

					{/* Info */}
					<div className="mt-6 p-4 bg-muted/50 rounded-lg">
						<p className="text-sm text-muted-foreground">
							This account will have full administrative access to PrismaLens.
							You can invite additional team members after setup.
						</p>
					</div>
				</div>

				{/* Footer */}
				<p className="text-center text-sm text-muted-foreground mt-6">
					PrismaLens Community Edition - Unlimited users, unlimited features
				</p>
			</div>
		</div>
	);
}
