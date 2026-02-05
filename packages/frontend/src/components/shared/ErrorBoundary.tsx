"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
	children: ReactNode;
	/** Fallback to show on error. If not provided, a default alert is shown. */
	fallback?: ReactNode;
	/** Called when an error is caught */
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
	retryCount: number;
}

export class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null, retryCount: 0 };
	}

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		this.props.onError?.(error, errorInfo);
	}

	override render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<Alert variant="destructive">
					<AlertCircle className="h-4 w-4" />
					<AlertTitle>Something went wrong</AlertTitle>
					<AlertDescription className="flex items-center justify-between">
						<span>{this.state.error?.message ?? "An unexpected error occurred"}</span>
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								this.setState((prev) => ({
									hasError: false,
									error: null,
									retryCount: prev.retryCount + 1,
								}))
							}
						>
							Retry
						</Button>
					</AlertDescription>
				</Alert>
			);
		}

		// Key forces full re-mount of children on retry, preventing stale-state loops
		return (
			<Fragment key={this.state.retryCount}>
				{this.props.children}
			</Fragment>
		);
	}
}
