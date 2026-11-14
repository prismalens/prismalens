// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { lazyPart } from "@/lib/lazy";
import { cn } from "@/lib/utils";
import {
	type FaultPlace,
	faultDetail,
	faultPlaceOf,
	faultPlaces,
} from "./fault-places";

// The copy button's registry block loads with a notice; until then, or offline, the text alone.
const FaultDetail = lazyPart(
	() => import("./FaultDetail").then((m) => m.FaultDetail),
	(p: { detail: string; children: ReactNode }) => (
		<div className="relative mt-1 text-left" data-testid="fault-detail">
			{p.children}
		</div>
	),
	{ now: true },
);

/**
 * A crash, worded for its place: a plain sentence and its next step, the
 * exception only behind Details with a copy button (#1101 cat 23).
 */
export function FaultNotice({
	place,
	error,
	onRetry,
	onHome,
	className,
}: {
	place: FaultPlace;
	error: unknown;
	onRetry: () => void;
	/** Go home in the app; a bare link when the shell itself failed. */
	onHome?: () => void;
	className?: string;
}) {
	const view = faultPlaces.get(place);
	const detail = faultDetail(
		error,
		typeof window === "undefined" ? undefined : window.location.pathname,
	);
	const pane = view.size === "pane";
	return (
		<div
			role="alert"
			data-testid="fault"
			data-place={place}
			className={cn(
				pane
					? "mx-auto flex w-full max-w-[760px] flex-col gap-2 px-4 py-5"
					: "mx-auto flex min-h-[60vh] w-full max-w-[520px] flex-col items-center justify-center gap-3 px-4 text-center",
				className,
			)}
		>
			<div
				className={cn(
					"flex gap-2",
					pane ? "items-center" : "flex-col items-center",
				)}
			>
				<AlertTriangle
					className={cn("shrink-0 text-danger", pane ? "size-4" : "size-6")}
					aria-hidden
				/>
				<h2 className={pane ? "text-body font-medium" : "text-title"}>
					{view.title}
				</h2>
			</div>
			<p className="text-body text-text-2">{view.line}</p>
			<div
				className={cn(
					"flex flex-wrap gap-2",
					pane ? "justify-start" : "justify-center",
				)}
			>
				<Button variant="primary" onClick={onRetry} data-testid="fault-retry">
					{view.retry}
				</Button>
				{view.home &&
					(onHome ? (
						<Button variant="secondary" onClick={onHome}>
							Go home
						</Button>
					) : (
						<Button variant="secondary" asChild>
							<a href="/">Go home</a>
						</Button>
					))}
			</div>
			<details
				className={cn("group w-full text-meta text-text-3", !pane && "pt-2")}
				data-testid="fault-details"
			>
				<summary className="inline-flex min-h-6 cursor-pointer items-center hover:text-text-1">
					Details
				</summary>
				<FaultDetail detail={detail}>
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-2 p-2 pr-9 font-mono text-meta text-text-2">
						{detail}
					</pre>
				</FaultDetail>
			</details>
		</div>
	);
}

/** A route's crash inside the shell: the sidebar stays, the page says what to do. */
export function RouteFault({ error, reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<FaultNotice
			place={faultPlaceOf(router.state.location.pathname)}
			error={error}
			onRetry={() => {
				reset();
				void router.invalidate();
			}}
			onHome={() => {
				reset();
				void router.navigate({ to: "/" });
			}}
		/>
	);
}

/** One pane's crash stays in that pane; Reload mounts it again. React's boundary is a class. */
export class FaultBoundary extends Component<
	{ place: FaultPlace; children: ReactNode },
	{ error: unknown; failed: boolean; mount: number }
> {
	state = { error: null as unknown, failed: false, mount: 0 };
	static getDerivedStateFromError(error: unknown) {
		return { error, failed: true };
	}
	render() {
		if (this.state.failed)
			return (
				<FaultNotice
					place={this.props.place}
					error={this.state.error}
					onRetry={() =>
						this.setState((s) => ({
							error: null,
							failed: false,
							mount: s.mount + 1,
						}))
					}
				/>
			);
		return (
			<Fragmented key={this.state.mount}>{this.props.children}</Fragmented>
		);
	}
}

function Fragmented({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
