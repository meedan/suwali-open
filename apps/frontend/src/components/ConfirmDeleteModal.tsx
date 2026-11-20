import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmDeleteModalProps = {
  open: boolean;
  entityTitle?: string;
  entityType: 'Document' | 'Contribution';
  onCancel: () => void;
  onConfirm: () => void;
};

const getEntityIcon = (entityType: ConfirmDeleteModalProps["entityType"]) => {
  switch (entityType) {
    case 'Document':
      return 'document';
    case 'Contribution':
      return 'users';
  }
};

const ConfirmDeleteModal = ({
  open,
  entityTitle,
  entityType,
  onCancel,
  onConfirm,
}: ConfirmDeleteModalProps) => {
  const entityName = entityType === 'Document' ? (
    <FormattedMessage
      id="global.document"
      defaultMessage="document"
      description="Label for document entity"
    />
  ) : (
    <FormattedMessage
      id="global.contribution"
      defaultMessage="contribution"
      description="Label for contribution entity"
    />
  );

  return (
    <Modal
      alert
      title={
        <FormattedMessage
          id="global.confirmDeleteModalTitle"
          defaultMessage="Remove {entity}?"
          description="Confirmation dialog title before removing an entity"
          values={{ entity: entityName }}
        />
      }
      titleContext={
        <>
          <Icon id={getEntityIcon(entityType)} aria-hidden />
          {entityTitle && <strong title={entityTitle}>{entityTitle}</strong>}
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
                id="global.confirmDeleteModalYesRemove"
                defaultMessage="Remove {entity}"
                description="Confirmation dialog submit button label before removing an entity"
                values={{ entity: entityName }}
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
            id="global.confirmDeleteModalAreYouSure"
            defaultMessage="Are you sure you want to <strong>remove</strong> this {entity}?"
            description="Confirmation dialog message before removing an entity"
            tagName="p"
            values={{
              entity: entityName,
              strong: msg => <strong key="strong">{msg}</strong>,
            }}
          />
          <FormattedMessage
            id="global.confirmDeleteModalInfo"
            defaultMessage="This {entity}’s contents will <strong>no longer</strong> be used in the chatbot’s responses."
            description="Confirmation dialog info message before removing an entity"
            tagName="p"
            values={{
              entity: entityName,
              strong: msg => <strong key="strong">{msg}</strong>,
            }}
          />
        </>
      }
    />
  );
};

export default ConfirmDeleteModal;
