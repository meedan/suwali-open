import type { ReactNode } from "react";
import { useState } from "react";
import { FormattedMessage } from "react-intl";

import type { DataSourceItem } from "@customTypes/data-source-item";

import { getNotebookItemTypeIconId } from "@helpers/source";

import { useDataSourceItemActions } from "@hooks/useDataSourceItemActions";

import Icon from "@ui-components/layout/Icon";
import ListItem from "@ui-components/layout/ListItem";

import ConfirmPauseModal from "@components/ConfirmPauseModal";
import DataSourceItemPreviewModal from "@components/DataSourceItemPreviewModal";

import styles from "./NodeContent.module.css";
import NodeContentTitle from "./NodeContentTitle";

type DataSourceItemsProps = {
  dataSourceItems: DataSourceItem[];
  title?: ReactNode;
};

const DataSourceItems = ({ dataSourceItems, title }: DataSourceItemsProps) => {
  const [previewItem, setPreviewItem] = useState<DataSourceItem | null>(null);
  const handleClosePreview = () => setPreviewItem(null);

  const {
    itemToPause,
    setItemToPause,
    handlePauseConfirm,
    handleTogglePreviewPause,
    handleTogglePriorityTier,
  } = useDataSourceItemActions<DataSourceItem>({
    invalidationKeys: [],
  });

  return (
    <>
      <NodeContentTitle iconId="database">
        {title ?? (
          <FormattedMessage
            id="global.dataSourceItemsNodeTitle"
            defaultMessage="{count, plural, =0 {Using 0 data source items to respond} one {Using 1 data source item to respond} other {Using # data source items to respond}}"
            description="Label that represents a work being done is querying for data source items"
            tagName="span"
            values={{ count: dataSourceItems.length}}
          />
        )}
      </NodeContentTitle>
      <div className={styles.nodeContent}>
        {dataSourceItems.map((dataSourceItem) => (
          <ListItem
            className={styles.nodeContentDataSourceItem}
            caption={
              dataSourceItem.deleted &&
              <FormattedMessage
                id="global.itemRemovedFromDataSources"
                defaultMessage="Item removed from data sources"
                description="Label that represents that an item has been deleted and removed from the system"
                tagName="em"
              />
            }
            id={dataSourceItem.id.toString()}
            icon={<Icon id={getNotebookItemTypeIconId(dataSourceItem.type)} aria-hidden />}
            key={dataSourceItem.id}
            title={dataSourceItem.title}
            onClick={dataSourceItem.deleted ? undefined : () => setPreviewItem(dataSourceItem)}
          />
        ))}
      </div>
      <ConfirmPauseModal
        open={Boolean(itemToPause)}
        paused={itemToPause?.active === false}
        entityTitle={itemToPause?.title}
        entityType={itemToPause?.type ?? 'Document'}
        onCancel={() => setItemToPause(null)}
        onConfirm={handlePauseConfirm}
      />
      <DataSourceItemPreviewModal
        open={Boolean(previewItem)}
        id={previewItem?.id}
        type={previewItem?.type}
        onOpenChange={handleClosePreview}
        onTogglePause={previewItem ? () => handleTogglePreviewPause(previewItem) : undefined}
        onTogglePriorityTier={previewItem ? () => handleTogglePriorityTier(previewItem) : undefined}
      />
    </>
  );
};

export default DataSourceItems;
