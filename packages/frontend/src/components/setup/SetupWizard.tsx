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
import { Button } from "@/components/ui/button";
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
			<div className="flex min-h-[80vh] items-center justify-center px-4">
				<div className="w-full max-w-sm">
					<h1 className="text-xl font-semibold tracking-tight">
						Setup is done
					</h1>
					<p className="mt-1 text-record text-muted-foreground">
						The owner account exists. Nothing else is needed here.
					</p>
					<Button asChild size="sm" className="mt-4 h-8">
						<Link to="/incidents">Go to incidents</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-[80vh] items-center justify-center px-4 py-8">
			<div className="w-full max-w-2xl px-4">
				<SetupStepOwner onComplete={handleAccountCreated} />
			</div>
		</div>
	);
}
