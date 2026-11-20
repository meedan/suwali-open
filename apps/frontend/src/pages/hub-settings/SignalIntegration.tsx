import { useEffect, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { QRCode } from 'react-qr-code';

import type { MessagingIntegration } from '@customTypes/messaging-integration';

import { getSignalLink } from '@helpers/messaging-platform';

import { connectMessagingIntegration, disconnectMessagingIntegration } from '@services/MessagingIntegrationsService';

import { HttpError, sanitizeApiErrors } from '@root/NetworkLayer';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import HintBox from '@ui-components/layout/HintBox';
import Icon from '@ui-components/layout/Icon';
import { PollingLoading } from '@ui-components/layout/LoadingIndicator';

import settingsStyles from '@pages/Settings.module.css';

import styles from './MessagingIntegrations.module.css';

const messages = defineMessages({
  signalConnectError: {
    id: 'messagingIntegrations.signalConnectError',
    defaultMessage: 'Something went wrong while connecting Signal. Please try again.',
    description: 'Fallback error message shown when connecting a Signal integration fails',
  },
});

// signal-cli gives up on a QR code that isn't scanned within this time
const LINK_VALIDITY_SECONDS = 120;

const formatCountdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

type SignalIntegrationProps = {
  hubId: number;
  integration?: MessagingIntegration;
  onChange: () => void;
  onDisconnect: () => void;
};

const SignalIntegration = ({ hubId, integration, onChange, onDisconnect }: SignalIntegrationProps) => {
  const intl = useIntl();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // The pending integration is created when the link starts, so its creation time is when the QR code was issued
  const linkStartedAt = integration?.signal_link?.status === 'pending' ? Date.parse(integration.created_at) : NaN;
  const secondsLeft = Number.isFinite(linkStartedAt)
    ? Math.max(0, Math.ceil(LINK_VALIDITY_SECONDS - (now - linkStartedAt) / 1000))
    : null;

  useEffect(() => {
    if (!Number.isFinite(linkStartedAt)) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [linkStartedAt]);

  const showError = (error: unknown) => {
    const message = error instanceof HttpError ? sanitizeApiErrors(error.data) : null;
    toast('error', message || intl.formatMessage(messages.signalConnectError));
  };

  const connect = async () => {
    setSaving(true);
    try {
      await connectMessagingIntegration(hubId, 'signal');
      onChange();
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  // A QR code can only be used once, so trying again starts a new link from scratch
  const restart = async () => {
    if (!integration) return;
    setSaving(true);
    try {
      await disconnectMessagingIntegration(integration.id);
      await connectMessagingIntegration(hubId, 'signal');
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
      onChange();
    }
  };

  const cancelButton = (
    <Button
      onClick={onDisconnect}
      label={
        <FormattedMessage
          id="global.cancel"
          defaultMessage="Cancel"
          description="Reusable label for cancel buttons"
        />
      }
      size="small"
      themeMode
    />
  );

  if (integration?.phone_number) {
    const signalLink = getSignalLink(integration.phone_number);
    return (
      <div className={styles.connected}>
        <FormattedMessage
          id="global.messagingIntegrationssignalConnected"
          defaultMessage="{icon} Connected phone number: {phoneNumber}"
          description="Information for a connected Signal account on Messaging Integrations page"
          values={{
            phoneNumber: <strong key="phoneNumber">{integration.phone_number}</strong>,
            icon: <Icon key="icon" id="check_seal_filled" />,
          }}
          tagName="span"
        />
        {signalLink && (
          <FormattedMessage
            id="global.messagingIntegrationssignalBotLink"
            defaultMessage="{icon} View in Signal: {signalBotLink}"
            description="Link to go to the chatbot on Signal"
            values={{
              signalBotLink: (
                <strong key="signalBotLink">
                  <a href={signalLink} target="_blank" rel="noopener noreferrer">{integration.phone_number}</a>
                </strong>
              ),
              icon: <Icon key="icon" id="arrow_square_out_filled" />,
            }}
            tagName="span"
          />
        )}
        <Button
          onClick={onDisconnect}
          label={
            <FormattedMessage
              id="global.messagingIntegrationsdisconnectSignal"
              defaultMessage="Disconnect Signal"
              description="Button label for disconnecting a messaging integration"
            />
          }
          size="small"
          themeMode
        />
      </div>
    );
  }

  if (integration?.signal_link?.status === 'failed' || secondsLeft === 0) {
    return (
      <div className={styles.pending}>
        <FormattedMessage
          id="global.messagingIntegrationssignalLinkFailed"
          defaultMessage="The QR code expired before it was scanned, or the phone couldn’t be linked. Please try again."
          description="Shown on the Signal integration when linking a phone by QR code didn’t complete"
          tagName="em"
        />
        <div className={styles.whatsAppButtons}>
          <Button
            disabled={saving}
            onClick={restart}
            label={
              <FormattedMessage
                id="global.messagingIntegrationssignalTryAgain"
                defaultMessage="Try again"
                description="Button label to start linking a Signal account again with a new QR code"
              />
            }
            size="small"
          />
          {cancelButton}
        </div>
      </div>
    );
  }

  if (integration?.signal_link?.uri) {
    return (
      <div className={styles.pending}>
        <FormattedMessage
          id="global.messagingIntegrationssignalScanInstructions"
          defaultMessage="On the phone with the Signal account your audience will message, open Signal, go to Settings > Linked devices, tap + and scan this QR code within 2 minutes. Once it’s connected, wait a minute before sending a test message."
          description="Instructions for linking a Signal account to the hub by scanning a QR code, which expires after 2 minutes"
          tagName="p"
        />
        <div className={styles.signalQrCode}>
          <QRCode level="M" size={256} value={integration.signal_link.uri} />
        </div>
        <div className={styles.waiting}>
          <PollingLoading />
          <FormattedMessage
            id="global.messagingIntegrationswaitingSignal"
            defaultMessage="Waiting for the QR code to be scanned…"
            description="Waiting message while a Signal account is being linked by QR code"
            tagName="em"
          />
        </div>
        {secondsLeft !== null && (
          <FormattedMessage
            id="global.messagingIntegrationssignalExpiresIn"
            defaultMessage="This QR code expires in {time}."
            description="Countdown shown under the Signal QR code until it expires, e.g. “This QR code expires in 1:43.”"
            values={{ time: formatCountdown(secondsLeft) }}
            tagName="p"
          />
        )}
        {cancelButton}
      </div>
    );
  }

  return (
    <>
      <HintBox
        type="info"
        body={
          <FormattedMessage
            id="global.messagingIntegrationssignalIntro"
            defaultMessage="Signal is known for its strong privacy: every message is end-to-end encrypted and it collects almost no data about its users."
            description="Intro description for Signal on Messaging Integrations page"
            tagName="span"
          />
        }
      />
      <br />
      <FormattedMessage
        id="global.messagingIntegrationssignalRequirement"
        defaultMessage="To connect Signal, you will need a phone with a Signal account for your audience to message. We recommend a dedicated number: the conversations with your audience will also appear on that phone."
        description="Explains what is needed to connect Signal on the Messaging Integrations page"
        tagName="p"
      />
      <div className={settingsStyles.buttonWrapper}>
        <Button
          disabled={saving}
          label={
            saving ?
              <FormattedMessage
                id="global.messagingIntegrationsconnectingSignal"
                defaultMessage="Connecting Signal…"
                description="Button label displayed while connecting a Signal integration"
              /> :
              <FormattedMessage
                id="global.messagingIntegrationsconnectSignal"
                defaultMessage="Connect Signal"
                description="Button label for connecting a Signal integration"
              />
          }
          onClick={connect}
          size="small"
        />
      </div>
    </>
  );
};

export default SignalIntegration;
