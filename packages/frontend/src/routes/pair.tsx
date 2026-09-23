// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The page a pairing link opens (ADR 0004 §8). The token rides in the URL
 * fragment, so it never reaches a server log; this page reads it, names the
 * device, redeems once, and lands in the app as a paired device.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { operatorQueryOptions, useOperator } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/pair")({
	ssr: false,
	component: PairPage,
});

function defaultDeviceName(): string {
	if (typeof navigator === "undefined") return "";
	const ua = navigator.userAgent;
	if (/iPhone/.test(ua)) return "iPhone";
	if (/iPad/.test(ua)) return "iPad";
	if (/Android/.test(ua)) return "Android phone";
	if (/Macintosh/.test(ua)) return "Mac";
	if (/Windows/.test(ua)) return "Windows PC";
	if (/Linux/.test(ua)) return "Linux machine";
	return "";
}

function PairPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [token, setToken] = useState<string | null>(null);
	const [name, setName] = useState(defaultDeviceName);
	const operator = useOperator();

	// `pl up` prints a fresh link on every start. A browser that already holds
	// this machine's session leaves it unused rather than pairing twice.
	useEffect(() => {
		if (token && operator.managesPairing) navigate({ to: "/" });
	}, [token, operator.managesPairing, navigate]);

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

	if (token === null || (token && operator.isPending)) return null;

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

	return (
		<Shell title="Pair this device">
			<form
				className="space-y-4"
				onSubmit={(e) => {
					e.preventDefault();
					redeem.mutate({ token, name: name.trim() || undefined });
				}}
			>
				<p className="text-record text-muted-foreground">
					This device will reach the instance until it is revoked from the host.
				</p>
				<div className="space-y-2">
					<Label htmlFor="device-name">Name this device</Label>
					<Input
						id="device-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Sumit's phone"
						maxLength={80}
						autoFocus
					/>
				</div>
				{redeem.isError && <MutationError error={redeem.error} />}
				<Button type="submit" className="w-full" disabled={redeem.isPending}>
					{redeem.isPending ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Pairing…
						</>
					) : (
						"Pair"
					)}
				</Button>
			</form>
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
