// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The Wave 2 design kit: one component per job (pattern sheet, #1101). */
export { Aside, type AsideEntry } from "./Aside";
export {
	type ActionCtx,
	type ActionDef,
	type ActionId,
	defineAction,
	defineSurface,
	type SurfaceCtx,
	type SurfaceDef,
	type SurfaceId,
} from "./actions";
export { DetailsCard, DetailsDock } from "./DetailsCard";
export {
	type Density,
	type DetailsRow,
	densityFor,
	dockFor,
	visibleRows,
} from "./details";
export {
	DETAILS_REGISTRY,
	type Details,
	type DetailsPr,
	detailsRows,
	type IncidentDetails,
	type ThreadDetails,
} from "./details-registry";
export { Help } from "./Help";
export { ListCard, ListGrid } from "./ListCard";
export { Mark } from "./Mark";
export {
	AgentBadge,
	BranchMark,
	middleCut,
	PrMark,
	RiskMark,
	StartedByMark,
	startedByLabel,
} from "./MarkBadges";
export {
	ContextMenu,
	commandEntries,
	isMenuKey,
	Menu,
	type MenuEntry,
	orderEntries,
} from "./Menu";
export {
	MARKS,
	type MarkId,
	markLook,
	type Reach,
	reachOf,
} from "./marks";
export { Picker, type PickerOption } from "./Picker";
export {
	KitPopover,
	POPOVER_WIDTH,
	type PopoverFamily,
} from "./Popover";
export { effortIcon, modeIcon } from "./picker-icons";
export {
	RAIL_WINDOW,
	Rail,
	type RailBreak,
	type RailItem,
	type RailTurnState,
	railWindow,
} from "./Rail";
export { ResponseActions } from "./ResponseActions";
export {
	activeEntries,
	activeSurface,
	allActions,
	allSurfaces,
	onActiveSurface,
	runAction,
	setActionKeys,
} from "./registry";
export { relTime, spanWord } from "./rel-time";
export {
	Status,
	type StatusKind,
	statusIcon,
	statusShort,
	statusText,
	statusTint,
	statusWord,
} from "./Status";
export { Strip, StripAction } from "./Strip";
export { Surface, SurfaceMore } from "./Surface";
export { type TabItem, TabPanel, Tabs } from "./Tabs";
export { Time } from "./Time";
export {
	TOOL_LINE,
	type ToolCall,
	ToolGroup,
	ToolLine,
	ToolLineChevron,
} from "./ToolLine";
