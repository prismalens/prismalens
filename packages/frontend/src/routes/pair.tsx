// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The page a pairing link opens (ADR 0004 §8). The token rides in the URL
 * fragment, so it never reaches a server log. The page reads it, drops it
 * from the address bar and redeems it at once, the way t3code does: no
 * form, no click. The device's name is the link's label, or one guessed
 * from the browser. What is left on screen is only what went wrong.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { operatorQueryOptions, useOperator } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/pair")({
	ssr: false,
	component: PairPage,
});

function guessDeviceName(): string | undefined {
	if (typeof navigator === "undefined") return undefined;
	const ua = navigator.userAgent;
	if (/iPhone/.test(ua)) return "iPhone";
	if (/iPad/.test(ua)) return "iPad";
	if (/Android/.test(ua)) return "Android phone";
	if (/Macintosh/.test(ua)) return "Mac";
	if (/Windows/.test(ua)) return "Windows PC";
	if (/Linux/.test(ua)) return "Linux machine";
	return undefined;
}

function PairPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [token, setToken] = useState<string | null>(null);
	const operator = useOperator();
	const started = useRef(false);

	useEffect(() => {
		const fragment = window.location.hash.replace(/^#/, "");
		// A second run (StrictMode in dev) finds the fragment already dropped and
		// must keep the token the first run read.
		setToken((read) => fragment || read || "");
		// The token is a one-time secret: drop it from the address bar at once.
		if (fragment) history.replaceState(null, "", window.location.pathname);
	}, []);

	const redeem = useMutation({
		...orpc.pairing.redeem.mutationOptions(),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: operatorQueryOptions().queryKey,
			});
			navigate({ to: "/" });
		},
	});

	useEffect(() => {
		if (!token || operator.isPending || started.current) return;
		started.current = true;
		// `pl up` prints a fresh link on every start. A browser that already
		// holds this machine's session leaves it unused rather than pairing twice.
		if (operator.managesPairing) {
			navigate({ to: "/" });
			return;
		}
		redeem.mutate({ token, name: guessDeviceName() });
	}, [token, operator.isPending, operator.managesPairing, navigate, redeem]);

	if (token === null) return null;

	if (!token) {
		return (
			<Shell title="Nothing to pair">
				<p className="text-record text-muted-foreground">
					This page needs a pairing link. On the machine running prismalens,
					open the link <code>pl up</code> printed, or create one: Settings →
					Devices, or <code>pl pair</code>.
				</p>
			</Shell>
		);
	}

	if (redeem.isError) {
		return (
			<Shell title="Could not pair">
				<MutationError error={redeem.error} />
				<p className="text-record text-muted-foreground">
					A link works once, for 15 minutes. Create a new one on the machine
					running prismalens: Settings → Devices, or <code>pl pair</code>.
				</p>
			</Shell>
		);
	}

	return (
		<Shell title="Pairing this device">
			<div className="flex items-center gap-2 text-record text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				Pairing…
			</div>
		</Shell>
	);
}

function Shell({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4">
			<div className="w-full max-w-sm space-y-6">
				<h1 className="text-title font-semibold">{title}</h1>
				{children}
			</div>
		</div>
	);
}
