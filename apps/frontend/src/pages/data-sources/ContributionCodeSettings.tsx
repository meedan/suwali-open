import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useQueryClient } from "@tanstack/react-query";

import { updateContributionCode } from "@services/HubService";

import { useSession } from "@root/SessionContext";

import { useToast } from '@hooks/useToast';

import Button from "@ui-components/input/Button";
import TextInput from "@ui-components/input/TextInput";

import ConfirmContributionCodeModal from './ConfirmContributionCodeModal';
import styles from './DataSourcesContributionsSettings.module.css';

const messages = defineMessages({
  updateSuccess: {
    id: 'global.contributionCodeUpdateSuccess',
    defaultMessage: 'Contribution code updated to {contributionCode}.',
    description: 'Toast message shown when the contribution code is updated successfully',
  },
  updateError: {
    id: 'global.contributionCodeUpdateError',
    defaultMessage: 'Failed to update contribution code.',
    description: 'Toast message shown when the contribution code update fails',
  },
});

// Kept in sync with the Hub::CONTRIBUTION_CODE_FORMAT validation on the API
const CONTRIBUTION_CODE_PATTERN = /^[\p{L}\p{N}]{6,36}$/u;

type ContributionCodeSettingsProps = {
  onClose: () => void;
};

const ContributionCodeSettings = ({ onClose }: ContributionCodeSettingsProps) => {
  const intl = useIntl();
  const session = useSession();
  const hub = session.currentHub();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const savedCode = (hub?.contribution_code || '').replace(/^#/, '');
  const [code, setCode] = useState(savedCode);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isValid = CONTRIBUTION_CODE_PATTERN.test(code);
  const hasChanges = code !== savedCode;

  const handleConfirm = () => {
    updateContributionCode(hub!.id, code)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: [`/hubs/${hub!.id}`] });
        setConfirmOpen(false);
        toast('success', intl.formatMessage(messages.updateSuccess, { contributionCode: `#${code}` }));
        onClose();
      })
      .catch(() => {
        setConfirmOpen(false);
        toast('error', intl.formatMessage(messages.updateError));
      });
  };

  return (
    <>
      <FormattedMessage
        id="global.contributionCode"
        defaultMessage="Contribution code"
        description="Reusable label for contribution code"
        tagName="h3"
      />
      <FormattedMessage
        id="global.contributionCodeDescription"
        defaultMessage="Share this contribution code with end-users who you want to allow to submit community contributions to your knowledge base."
        description="Description on how to invite end-users to contribute"
        tagName="p"
      />
      <div className={styles.contributionCodeInput}>
        <TextInput
          error={hasChanges && !isValid ? (
            <FormattedMessage
              id="global.contributionCodeInvalid"
              defaultMessage="The contribution code must have between 6 and 36 letters or digits, with no spaces or punctuation."
              description="Error shown when the contribution code typed by the user is not valid"
            />
          ) : undefined}
          helpContent={
            <FormattedMessage
              id="global.contributionCodeHelp"
              defaultMessage="A good contribution code will be short and memorable like a social media hashtag."
              description="Hint shown below the contribution code field"
            />
          }
          prefix="#"
          size="large"
          value={code}
          onChange={e => setCode(e.target.value.trim().replace(/^#+/, ''))}
        />
      </div>
      <div className={styles.customizeActions}>
        <Button
          disabled={!hasChanges || !isValid}
          label={
            <FormattedMessage
              id="global.updateCode"
              defaultMessage="Update code"
              description="Button label to update the contribution code"
            />
          }
          size="small"
          variant="filled"
          onClick={() => setConfirmOpen(true)}
        />
        <Button
          label={
            <FormattedMessage
              id="global.cancel"
              defaultMessage="Cancel"
              description="Reusable label for cancel buttons"
            />
          }
          size="small"
          variant="text"
          themeMode
          onClick={onClose}
        />
      </div>
      <ConfirmContributionCodeModal
        contributionCode={`#${code}`}
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
};

export default ContributionCodeSettings;
