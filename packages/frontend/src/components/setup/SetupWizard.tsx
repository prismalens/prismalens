// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * The first-run wizard (#332, narrowed by #337/#609).
 *
 * One step: the owner account. The AI-provider, code-location and
 * first-incident steps are gone — a harness is detected from PATH
 * (`GET /settings/harnesses`) and a repo is linked from a service's
 * Repositories tab, neither of which needs a wizard page. Once the account
 * exists, `setupComplete` is true and `/_authenticated` stops redirecting
 * here, so this component's only job is to create that account and hand off.
 */

import { Link } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/lib/auth";
import { SetupStepOwner } from "./SetupStepOwner";

export interface SetupWizardProps {
	/** Redirect URL after setup completes */
	redirect?: string;
}

export function SetupWizard({ redirect }: SetupWizardProps) {
	const {
		data: session,
		isPending: sessionPending,
		refetch: refetchSession,
	} = useSession();

	const getRedirectDestination = () => {
		if (redirect) {
			try {
				const url = new URL(redirect, window.location.origin);
				return url.pathname;
			} catch {
				return "/incidents";
			}
		}
		return "/incidents";
	};

	const handleAccountCreated = async () => {
		// The account step mints a session server-side (#358), but Better Auth's
		// `useSession()` store is not told, so refetch before handing off — a
		// stale empty session would bounce a brand-new owner to sign-in.
		await refetchSession();
		window.location.href = getRedirectDestination();
	};

	// Someone reloaded /setup after the account already exists (an old bookmark
	// or a `redirect` that pointed back here). setupComplete is already true, so
	// `/_authenticated` will not bounce them back — just send them on.
	if (!sessionPending && session?.user) {
		return (
			<div className="min-h-[80vh] flex items-center justify-center">
				<div className="w-full max-w-md">
					<Card>
						<CardHeader className="text-center">
							<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
								<LogIn className="h-8 w-8 text-primary" />
							</div>
							<CardTitle>
								<h2>Setup is already complete</h2>
							</CardTitle>
							<CardDescription>PrismaLens is ready to use.</CardDescription>
						</CardHeader>
						<CardContent className="flex justify-center">
							<Button asChild>
								<Link to="/incidents">Go to incidents</Link>
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-[80vh] flex items-center justify-center py-8">
			<div className="w-full max-w-2xl px-4">
				<SetupStepOwner onComplete={handleAccountCreated} />
			</div>
		</div>
	);
}
