import { Fragment } from 'react';
import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';

type ConfirmPauseModalProps = {
  open: boolean;
  paused: boolean;
  entityTitle?: string;
  entityType: 'Document' | 'Contribution' | 'Notebook' | 'Source';
  onCancel: () => void;
  onConfirm: () => void;
};

const getEntityIcon = (entityType: ConfirmPauseModalProps["entityType"]) => {
  switch (entityType) {
    case 'Document':
      return 'document';
    case 'Contribution':
      return 'users';
    case 'Notebook':
      return 'notebook';
    case 'Source':
      return 'graph';
  }
};

const getEntityName = (entityType: ConfirmPauseModalProps["entityType"]) => {
  switch (entityType) {
    case 'Document':
      return <FormattedMessage
        id="global.document"
        defaultMessage="document"
        description="Label for document entity"
      />;
    case 'Contribution':
      return <FormattedMessage
        id="global.contribution"
        defaultMessage="contribution"
        description="Label for contribution entity"
      />;
    case 'Notebook':
      return <FormattedMessage
        id="global.notebookSummary"
        defaultMessage="notebook summary"
        description="Label for notebook entity"
      />;
    case 'Source':
      return <FormattedMessage
        id="global.dataSource"
        defaultMessage="data source"
        description="Label for data source entity"
      />;
  }
};

const pauseDetails = (entityType: ConfirmPauseModalProps["entityType"]) => {
  switch (entityType) {
    case 'Source':
      return <FormattedMessage
        id="global.confirmPauseModalAreYouSurePauseSourceDetails"
        defaultMessage="<strong>New documents</strong> will stop being synced with the system. All existing documents will remain available to the chatbot to respond to end-users."
        description="Confirmation dialog message details before pausing a source entity"
        tagName="p"
        values={{
          strong: msg => <strong key="strong">{msg}</strong>,
        }}
      />;
    default:
      return <FormattedMessage
        id="global.confirmPauseModalAreYouSurePauseDetails"
        defaultMessage="The text in this {entityType} will <strong>no longer be available</strong> to the chatbot to respond to end-users."
        description="Confirmation dialog message details before pausing an entity including an entityType which is a noun representing a type of document"
        tagName="p"
        values={{
          strong: msg => <strong key="strong">{msg}</strong>,
          entityType: <Fragment key="entityType">{getEntityName(entityType)}</Fragment>,
        }}
      />
  }
};

const reactivateDetails = (entityType: ConfirmPauseModalProps["entityType"]) => {
  switch (entityType) {
    case 'Source':
      return <FormattedMessage
        id="global.confirmPauseModalAreYouSureUnpauseSourceDetails"
        defaultMessage="<strong>New documents</strong> will begin to sync and become available to the chatbot to respond to end-users."
        description="Confirmation dialog message details before reactivating a source entity"
        tagName="p"
        values={{
          strong: msg => <strong key="strong">{msg}</strong>,
        }}
      />;
    default:
      return <FormattedMessage
        id="global.confirmPauseModalAreYouSureUnpauseDetails"
        defaultMessage="The text in this {entityType} <strong>will be available</strong> to the chatbot to respond to end-users."
        description="Confirmation dialog message details before reactivating an entityType which is a noun representing a type of document"
        tagName="p"
        values={{
          strong: msg => <strong key="strong">{msg}</strong>,
          entityType: <Fragment key="entityType">{getEntityName(entityType)}</Fragment>,
        }}
      />;
  }
};

const ConfirmPauseModal = ({
  open,
  paused,
  entityTitle,
  entityType,
  onCancel,
  onConfirm,
}: ConfirmPauseModalProps) => {
  return (
    <Modal
      alert
      title={
        paused ?
        <FormattedMessage
          id="global.confirmPauseModalUnpauseTitle"
          defaultMessage="Reactivate {entityType}?"
          description="Confirmation dialog title before reactivating an entityType which is a noun representing a type of document"
          values={{
            entityType: <Fragment key="entityType">{getEntityName(entityType)}</Fragment>
          }}
        /> :
        <FormattedMessage
          id="global.confirmPauseModalPauseTitle"
          defaultMessage="Pause {entityType}?"
          description="Confirmation dialog title before pausing an entityType which is a noun representing a type of document"
          values={{
            entityType: <Fragment key="entityType">{getEntityName(entityType)}</Fragment>
            }}
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
              paused ?
              <FormattedMessage
                id="global.confirmPauseModalYesUnpause"
                defaultMessage="Yes, reactivate"
                description="Confirmation dialog submit button label for reactivating"
              /> :
              <FormattedMessage
                id="global.confirmPauseModalYesPause"
                defaultMessage="Yes, pause"
                description="Confirmation dialog submit button label for pausing"
              />
            }
            size="small"
            onClick={onConfirm}
          />
        </>
      }
      body={paused ?
        <>
          <FormattedMessage
            id="global.confirmPauseModalAreYouSureUnpause"
            defaultMessage="Are you sure you want to <strong>reactivate</strong> this {entityType}?"
            description="Confirmation dialog message before reactivating an entityType which is a noun representing a type of document"
            tagName="p"
            values={{
              strong: msg => <strong key="strong">{msg}</strong>,
              entityType: <Fragment key="entityType">{getEntityName(entityType)}</Fragment>,
            }}
          />
          {reactivateDetails(entityType)}
          <FormattedMessage
            id="global.pauseAgain"
            defaultMessage="You can pause it again at any time."
            description="Confirmation dialog message before telling the user than can pause again"
            tagName="p"
          />
        </> :
        <>
          <FormattedMessage
            id="global.confirmPauseModalAreYouSurePause"
            defaultMessage="Are you sure you want to <strong>pause</strong> this {entityType}?"
            description="Confirmation dialog message before pausing an entityType which is a noun representing a type of document"
            tagName="p"
            values={{
              strong: msg => <strong key="strong">{msg}</strong>,
              entityType: <Fragment key="entityType">{getEntityName(entityType)}</Fragment>,
            }}
          />
          {pauseDetails(entityType)}
          <FormattedMessage
            id="global.reactivateAgain"
            defaultMessage="You can reactivate it at any time."
            description="Confirmation dialog message before telling the user than can undo the pause and reactivate again"
            tagName="p"
          />
        </>
      }
    />
  );
};

export default ConfirmPauseModal;
