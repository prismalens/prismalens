// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The first-run offer above the Agents list (#1180 §3.2): shown until the person
 * chooses, once any installed agent has a server a share can start from.
 */
import { useState } from "react";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import {
	useSharedSet,
	useSharedSources,
	useUpdateSharedSet,
} from "@/lib/api/hooks/use-agent-setup-orpc";
import { ShareServerDialog } from "./SharedSetSettings";

export const OFFER_TITLE = "Your agents' setups";

export function SharedSetOfferView({
	pending,
	onAsIs,
	onShare,
}: {
	pending: boolean;
	onAsIs: () => void;
	onShare: () => void;
}) {
	return (
		<SettingGroup title={OFFER_TITLE} testId="shared-set-offer">
			<Pool>
				<Row
					label="Each agent keeps its own config"
					meta="Or share its MCP servers with every agent, as you approve them."
					stackOnPhone
					trailing={
						<>
							<Button
								variant="secondary"
								size="sm"
								disabled={pending}
								onClick={onAsIs}
								data-testid="shared-set-offer-as-is"
							>
								Use as set up
							</Button>
							<Button
								size="sm"
								disabled={pending}
								onClick={onShare}
								data-testid="shared-set-offer-share"
							>
								Share with every agent
							</Button>
						</>
					}
				/>
			</Pool>
		</SettingGroup>
	);
}

export function SharedSetOffer() {
	const set = useSharedSet().data;
	const sources = useSharedSources().data;
	const update = useUpdateSharedSet();
	const [sharing, setSharing] = useState(false);
	if (!set || set.decided !== null || !sources?.length) return null;
	return (
		<>
			<SharedSetOfferView
				pending={update.isPending}
				onAsIs={() => update.mutate({ decided: "as-is" })}
				onShare={() => setSharing(true)}
			/>
			<ShareServerDialog
				open={sharing}
				onOpenChange={setSharing}
				onSaved={() => update.mutate({ decided: "shared" })}
			/>
		</>
	);
}
