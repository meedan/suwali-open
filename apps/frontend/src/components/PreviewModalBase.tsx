import { useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import MetaList from "@ui-components/layout/MetaList";
import { Modal } from "@ui-components/layout/Modal";
import StatusBanner from "@ui-components/layout/StatusBanner";

import styles from './DocumentPreviewModal.module.css';

const messages = defineMessages({
  paneToggle: {
    id: 'global.previewModalPaneToggle',
    defaultMessage: 'Show the preview or its details',
    description: 'Accessible label for the switch between the preview and its details, shown when the window is too narrow for both',
  },
});

type PreviewModalBaseProps = {
  actions?: React.ReactNode;
  active?: boolean;
  className?: string;
  syncStatus?: 'pending' | 'error' | 'complete';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  titleContext?: string | React.ReactNode;
  details: React.ReactNode;
  // Where the details go: in a row above the content, or in a column beside it, which needs the wider
  // modal and so is for previews with details enough to fill one. The two columns scroll on their own.
  detailsPlacement?: 'top' | 'side';
  // Details that stay in a row across the top with the details beside the content, because they need the width
  // or are about the modal as a whole. Ignored when the details are above the content anyway.
  topDetails?: React.ReactNode;
  content: React.ReactNode;
};

const PreviewModalBase = ({
  actions,
  active = true,
  className,
  syncStatus,
  open,
  onOpenChange,
  title,
  titleContext,
  details,
  detailsPlacement = 'top',
  topDetails,
  content,
}: PreviewModalBaseProps) => {
  const intl = useIntl();
  const isSide = detailsPlacement === 'side';
  // Which of the two columns shows when there is only room for one
  const [pane, setPane] = useState<'content' | 'details'>('content');

  const banners = (
    <>
      {syncStatus === 'pending' && active !== false && <StatusBanner status="processing" /> }
      {syncStatus === 'error' && <StatusBanner status="error" /> }
      {syncStatus === 'pending' && active === false && <StatusBanner status="pausing" />}
      {active === false && syncStatus !== 'pending' && <StatusBanner status="paused" />}
    </>
  );

  // Beside the content the details are sections of fields of their own, and not a list that runs on across the row
  const detailsContent = isSide ? (
    details
  ) : (
    <MetaList className={styles.detailsMeta}>
      {details}
    </MetaList>
  );

  return (
    <Modal
      className={className}
      details={isSide ? (topDetails && (
        <MetaList className={styles.detailsMeta}>
          {topDetails}
        </MetaList>
      )) : detailsContent}
      body={isSide ? (
        // The details come first in the document, as they do when above the content, and are placed beside it
        // by the layout. Narrower than two columns fit, they stack with the details above. The banners are about the
        // item as a whole, so they span both columns.
        <div className={styles.sideContainer}>
          {banners}
          <ToggleGroup
            aria-label={intl.formatMessage(messages.paneToggle)}
            className={styles.paneToggle}
            size="small"
            type="single"
            value={pane}
            // A single toggle group lets the chosen item be deselected, which would leave nothing showing
            onValueChange={(value) => value && setPane(value as 'content' | 'details')}
          >
            <ToggleGroupItem value="content">
              <FormattedMessage
                id="global.previewModalPaneContent"
                defaultMessage="Preview"
                description="Label of the switch option that shows the preview of an item, when the window is too narrow to show it beside its details"
              />
            </ToggleGroupItem>
            <ToggleGroupItem value="details">
              <FormattedMessage
                id="global.previewModalPaneDetails"
                defaultMessage="Details"
                description="Label of the switch option that shows the details of an item, when the window is too narrow to show them beside its preview"
              />
            </ToggleGroupItem>
          </ToggleGroup>
          <div className={styles.sideLayout} data-pane={pane}>
            <div className={styles.sideDetails}>
              {detailsContent}
            </div>
            <div className={styles.sideContent}>
              <div className={styles.content}>
                {content}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.bodyWrapper}>
          {banners}
          <div className={styles.content}>
            {content}
          </div>
        </div>
      )}
      disableOpenAutoFocus
      open={open}
      size={isSide ? 'xlarge' : 'large'}
      title={title}
      titleContext={titleContext}
      onOpenChange={onOpenChange}
      actions={actions}
    />
  );
};

export default PreviewModalBase;
