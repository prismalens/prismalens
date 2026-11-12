/**
 * The landing screen. A phone lands on what needs you (#1101 category 5 item 2);
 * a wider screen lands on New, whose sidebar already lists the threads (#598, #609).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { PhoneHome } from "@/components/home/PhoneHome";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";

export const Route = createFileRoute("/_authenticated/")({
	component: Landing,
});

function Landing() {
	// A hydrating first render reads the hook's server answer (false); the window is the truth.
	const phone =
		useMediaQuery(PHONE) ||
		(typeof window !== "undefined" && window.matchMedia(PHONE).matches);
	return phone ? <PhoneHome /> : <Navigate to="/new" replace />;
}
