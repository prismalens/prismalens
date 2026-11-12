// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The Wave 2 design kit: one component per job (pattern sheet, #1101). */
export { Aside, type AsideEntry } from "./Aside";
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
export { ContextMenu, Menu, type MenuEntry } from "./Menu";
export { Picker, type PickerOption } from "./Picker";
export {
	KitPopover,
	POPOVER_WIDTH,
	type PopoverFamily,
} from "./Popover";
export { effortIcon, modeIcon } from "./picker-icons";
export {
	clusterTicks,
	nearest,
	Rail,
	type RailItem,
	type RailTick,
} from "./Rail";
export { ResponseActions } from "./ResponseActions";
export { Status, type StatusKind, statusWord } from "./Status";
export { Strip, StripAction } from "./Strip";
export { type TabItem, TabPanel, Tabs } from "./Tabs";
export {
	TOOL_LINE,
	type ToolCall,
	ToolGroup,
	ToolLine,
	ToolLineChevron,
} from "./ToolLine";
