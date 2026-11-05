// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link, useNavigate } from "@tanstack/react-router";
import { SquarePen } from "lucide-react";
import { useCallback } from "react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** `c`: New thread with Incident on (#1020). */
export const NEW_INCIDENT_KEY = "c";

/** Opens New thread with Incident on; the composer's text becomes the brief. */
export function useNewIncident() {
	const navigate = useNavigate();
	return useCallback(
		() => void navigate({ to: "/threads/new", search: { incident: true } }),
		[navigate],
	);
}

/** The header's primary on every list screen, the phone's included (#1020). */
export function NewThreadButton({ className }: { className?: string }) {
	return (
		<Hint label="New thread" keys={["Ctrl", "Shift", "O"]}>
			<Button variant="secondary" className={cn("pl-2.5", className)} asChild>
				<Link to="/threads/new" data-testid="new-thread-button">
					<SquarePen />
					New thread
				</Link>
			</Button>
		</Hint>
	);
}
