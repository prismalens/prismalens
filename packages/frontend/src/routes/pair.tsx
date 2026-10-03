// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The page a pairing link opens (ADR 0004 §8). The token rides in the URL
 * fragment, so it never reaches a server log. The page reads it, drops it
 * from the address bar and redeems it at once, the way t3code does: no
 * form, no click. The device's name is the link's label, else its model, else
 * its browser. What is left on screen is only what went wrong, and the two
 * ways to get a new link.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { MutationError } from "@/components/shared/MutationError";
import { operatorQueryOptions, useOperator } from "@/hooks/use-operator";
import { usePageTitle } from "@/hooks/use-page-title";
import { orpc } from "@/lib/api/orpc-client";
import { pairingName } from "@/lib/device-name";

export const Route = createFileRoute("/pair")({
	ssr: false,
	component: PairPage,
});

function PairPage() {
	usePageTitle("Pair this device");
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [token, setToken] = useState<string | null>(null);
	const operator = useOperator();
	const attempted = useRef<string | null>(null);

	useEffect(() => {
		const readFragment = () => {
			const fragment = window.location.hash.replace(/^#/, "");
			// A second run (StrictMode in dev) finds the fragment already dropped and
			// must keep the token the first run read.
			setToken((read) => fragment || read || "");
			// The token is a one-time secret: drop it from the address bar at once.
			if (fragment) history.replaceState(null, "", window.location.pathname);
		};
		readFragment();
		// A link pasted into a tab already on /pair changes only the fragment: no reload.
		window.addEventListener("hashchange", readFragment);
		return () => window.removeEventListener("hashchange", readFragment);
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
		// Keyed on the token, so a new link pasted after a failed one is redeemed.
		if (!token || operator.isPending || attempted.current === token) return;
		attempted.current = token;
		// `pl up` prints a fresh link on every start. A browser that already
		// holds this machine's session leaves it unused rather than pairing twice.
		if (operator.managesPairing) {
			navigate({ to: "/" });
			return;
		}
		void (async () => {
			const name =
				typeof navigator === "undefined"
					? undefined
					: await pairingName(navigator);
			redeem.mutate({ token, name });
		})();
	}, [token, operator.isPending, operator.managesPairing, navigate, redeem]);

	return (
		<PairView token={token} operatorReason={operator.reason} redeem={redeem} />
	);
}

type LinkProblem = "used" | "expired" | "invalid";

function linkProblem(error: unknown): LinkProblem | null {
	const reason = (error as { data?: { reason?: unknown } } | null)?.data
		?.reason;
	return reason === "used" || reason === "expired" || reason === "invalid"
		? reason
		: null;
}

const PROBLEM_TITLE: Record<LinkProblem, string> = {
	used: "This link has been used.",
	expired: "This link has expired.",
	invalid: "This link is not valid.",
};

export function PairView({
	token,
	operatorReason,
	redeem,
}: {
	token: string | null;
	operatorReason?: string | null;
	redeem: { isError: boolean; error: Error | null | undefined };
}) {
	if (token === null) return null;

	if (!token) {
		if (operatorReason === "revoked") {
			return (
				<Shell title="Device revoked">
					<p className="mt-2 text-body text-text-2">
						This device was revoked on the machine running PrismaLens. Ask for a
						new pairing link.
					</p>
					<GetANewOne />
				</Shell>
			);
		}
		return (
			<Shell title="Nothing to pair">
				<p className="mt-2 text-body text-text-2">
					This page opens a pairing link, and none came with it.
				</p>
				<GetANewOne />
			</Shell>
		);
	}

	if (redeem.isError) {
		const problem = linkProblem(redeem.error);
		return (
			<Shell title={problem ? PROBLEM_TITLE[problem] : "Could not pair"}>
				{problem ? (
					<p className="mt-2 text-body text-text-2" data-testid="pair-problem">
						A pairing link works once, for 15 minutes.
					</p>
				) : (
					<MutationError error={redeem.error} className="mt-3" />
				)}
				<GetANewOne />
			</Shell>
		);
	}

	return (
		<Shell title="Pairing this device">
			<p className="mt-2 flex items-center gap-2 text-body text-text-2">
				<Loader2 className="size-3.5 motion-safe:animate-spin" />
				Pairing
			</p>
		</Shell>
	);
}

/** The two ways to get a link, said once on every page that needs one. */
function GetANewOne() {
	return (
		<section className="mt-8" data-testid="pair-get-new">
			<h2 className="mb-2 text-heading">Get a new one</h2>
			<ul>
				<li className="border-t border-hairline py-2.5 text-body first:border-t-0">
					On the machine running PrismaLens, open Settings, Devices, and press
					Create a link.
				</li>
				<li className="border-t border-hairline py-2.5 text-body">
					Or run <code>pl pair --tailscale</code> there and open the link it
					prints on this device.
				</li>
			</ul>
		</section>
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
		<div className="fixed inset-0 overflow-y-auto bg-canvas px-6">
			<div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center py-8">
				<div className="mb-6 flex items-center gap-2.5 text-body font-semibold">
					<PrismaLensMark className="size-[18px]" />
					PrismaLens
				</div>
				<h1 className="text-display">{title}</h1>
				{children}
			</div>
		</div>
	);
}
