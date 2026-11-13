/**
 * The landing screen is Home at every width: the composer first, then what
 * needs you and what changed (#1101 F3), so a phone and a desk read the same page.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/")({
	component: () => <Navigate to="/new" replace />,
});
