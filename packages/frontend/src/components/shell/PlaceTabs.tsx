// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { Tabs } from "@/components/kit/Tabs";
import { Hint } from "@/components/shared/Hint";
import { type PlaceId, placeOf, placeTabs } from "@/lib/places";

/**
 * A door's page title as tabs: the door's place and the places inside it, from
 * the places registry, so the nav names one place and the page names its parts (#1101 nav).
 */
export function PlaceTabs({ id }: { id: PlaceId }) {
	const navigate = useNavigate();
	const tabs = placeTabs(id);
	return (
		<Tabs
			label={tabs[0]?.label ?? placeOf(id).label}
			items={tabs.map((p) => ({
				value: p.id,
				label: p.label,
				testId: `place-tab-${p.id}`,
			}))}
			value={id}
			onValueChange={(v) => void navigate({ to: placeOf(v as PlaceId).to })}
			wrap={(item, tab) => {
				const hint = placeOf(item.value as PlaceId).hint;
				return hint ? <Hint label={hint}>{tab}</Hint> : tab;
			}}
		/>
	);
}
