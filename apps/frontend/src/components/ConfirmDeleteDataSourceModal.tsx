import { FormattedMessage } from 'react-intl';

import type { Source } from '@customTypes/source';

import { getSourceTypeIcon } from "@helpers/source";

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDeleteDataSourceModalProps = {
  open: boolean;
  source: Source | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const ConfirmDeleteDataSourceModal = ({
  open,
  source,
  onCancel,
  onConfirm,
}: ConfirmDeleteDataSourceModalProps) => (
  <Modal
    alert
    title={
      <FormattedMessage
        id="global.confirmDeleteDataSourceModaltitle"
        defaultMessage="Remove data source?"
        description="Confirmation dialog title before removing a data source"
      />
    }
    titleContext={
      <>
        <Icon id={getSourceTypeIcon(source?.source_type ?? '')} aria-hidden />
        <strong title={source?.name}>{source?.name}</strong>
      </>
    }
    open={open}
    size="small"
    actions={
      <>
        <Button
          label={
            <FormattedMessage
              id="global.cancel"
              defaultMessage="Cancel"
              description="Reusable label for cancel buttons"
            />
          }
          size="small"
          themeMode
          variant="text"
          onClick={onCancel}
        />
        <Button
          label={
            <FormattedMessage
              id="global.confirmDeleteDataSourceModalyesRemove"
              defaultMessage="Remove data source"
              description="Confirmation dialog submit button label before removing a data source"
            />
          }
          size="small"
          onClick={onConfirm}
        />
      </>
    }
    body={
      <>
        <FormattedMessage
          id="global.confirmDeleteDataSourceModalareYouSure"
          defaultMessage="Are you sure you want to <strong>remove this data source</strong>?"
          description="Confirmation dialog message before unremoving a data source"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="global.confirmDeleteDataSourceModalareYouSureInfo"
          defaultMessage="The data source’s documents will <strong>no longer</strong> be used in the chatbot’s responses."
          description="Confirmation dialog message details before unremoving a data source"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      </>
    }
  />
);

export default ConfirmDeleteDataSourceModal;
