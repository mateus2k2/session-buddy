import { useSortable } from "@dnd-kit/react/sortable";
import { TabRow } from "../views/TabRow";
import type { Tab } from "../../context/types";

interface Props {
  id: string;
  tab: Tab;
  winKey: string;
  index: number;  // position within the window (for sortable ordering)
  tabKey: string; // wi:ti key for selection
  query: string;
  selectable?: boolean;
  isLiveTab?: boolean;
  editMode?: boolean;
  selectedKeys: Set<string>;
  depth?: number;
  onUngroup?: () => void;
}

export function SortableTab({
  id, tab, winKey, index, tabKey, query, selectable, isLiveTab, editMode, selectedKeys, depth, onUngroup,
}: Props) {
  const { ref, isDragging } = useSortable({
    id,
    index,
    type: "item",
    accept: "item",
    group: winKey,
  });

  return (
    <TabRow
      nodeRef={ref}
      isDragging={isDragging}
      tab={tab}
      tabKey={tabKey}
      groupColor={tab.groupColor ?? null}
      query={query}
      selectable={selectable}
      isLiveTab={isLiveTab}
      editMode={editMode}
      depth={depth}
      onUngroup={onUngroup}
    />
  );
}
