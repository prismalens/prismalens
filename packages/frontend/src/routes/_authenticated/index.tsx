/**
 * The landing screen is the incident queue (#598, #609). Command Center is gone;
 * it summarised other screens and carried no job of its own.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/")({
	component: () => <Navigate to="/incidents" replace />,
});
