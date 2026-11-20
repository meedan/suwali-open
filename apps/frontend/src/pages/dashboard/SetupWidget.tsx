import { useRef } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { QRCode } from "react-qr-code";
import { useNavigate, useSearchParams } from "react-router";

import type { MessagingIntegration } from "@customTypes/messaging-integration";

import { getSignalLink, getSmsLink, getTelegramLink, getWhatsappLink } from "@helpers/messaging-platform";

import { useSession } from "@root/SessionContext";

import { useHubPath } from '@hooks/useHubPath';
import { useSetupWidgetState } from '@hooks/useSetupWidgetState';
import { useSignalEnabled } from '@hooks/useSignalEnabled';
import { useToast } from "@hooks/useToast";

import Button from "@ui-components/input/Button";
import Icon from "@ui-components/layout/Icon";
import PlatformCaption from "@ui-components/layout/PlatformCaption";
import { Widget } from "@ui-components/layout/Widget";

import styles from './SetupWidget.module.css';

const messages = defineMessages({
  downloadSuccess: {
    id: 'global.downloadQrCodeSuccess',
    defaultMessage: 'QR code downloaded',
    description: 'Toast message shown after a QR code is successfully downloaded',
  },
});

const getPlatformDetails = (integration: MessagingIntegration) => {
  switch (integration.platform) {
    case 'telegram': {
      const link = getTelegramLink(integration.bot_username);
      return link ? { link, name: integration.bot_name } : null;
    }
    case 'whatsapp': {
      const link = getWhatsappLink(integration.phone_number);
      return link ? { link, name: integration.phone_number } : null;
    }
    case 'sms': {
      const link = getSmsLink(integration.phone_number);
      return link ? { link, name: integration.phone_number } : null;
    }
    case 'signal': {
      const link = getSignalLink(integration.phone_number);
      return link ? { link, name: integration.phone_number } : null;
    }
    default:
      return null;
  }
};

type IntegrationItemProps = {
  integration: MessagingIntegration;
};

const IntegrationItem = ({ integration }: IntegrationItemProps) => {
  const intl = useIntl();
  const { toast } = useToast();
  const qrRef = useRef<HTMLDivElement>(null);

  const details = getPlatformDetails(integration);
  if (!details) return null;

  const downloadQR = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const downloadLink = document.createElement("a");
    downloadLink.download = "qrcode.svg";
    downloadLink.href = url;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);

    toast('success', intl.formatMessage(messages.downloadSuccess));
  };

  return (
    <div className={styles.messagingIntegration}>
      <div className={styles.messagingIntegrationInfo}>
        <PlatformCaption id={integration.platform} />
        <span dir={integration.platform === 'whatsapp' ? 'ltr' : undefined}>{details.name}</span>
        <a href={details.link} target="_blank" rel="noopener noreferrer">
          {details.link}
        </a>
      </div>
      <div className={styles.qrWrapper}>
        <div ref={qrRef} className={styles.qrCodeHolder}>
          <QRCode
            className={styles.qrCode}
            level="M"
            size={256}
            value={details.link}
            viewBox="0 0 256 256"
          />
        </div>
        <Button
          label={
            <FormattedMessage
              id="global.download"
              defaultMessage="Download"
              description="Generic reusable label for download actions"
            />
          }
          size="small"
          themeMode
          onClick={downloadQR}
        />
      </div>
    </div>
  );
};

type SetupCardProps = {
  action?: React.ReactNode;
  icons: React.ReactNode;
  title: React.ReactNode;
  text: React.ReactNode;
};

const SetupCard = ({ action, icons, title, text }: SetupCardProps) => (
  <Widget className={styles.setupPromptWrapper}>
    <div className={styles.setupPromptContent}>
      {icons}
      <Widget.Headline title={title} />
      <Widget.Body>
        {text}
        {action ? <div className={styles.setupPromptActions}>{action}</div> : null}
      </Widget.Body>
    </div>
  </Widget>
);

const SetupWidget = ({ onHide }: {
  onHide?: () => void,
}) => {
  const hubId = useSession().currentHubId();
  const navigate = useNavigate();
  const setSearchParams = useSearchParams()[1];
  const hubPath = useHubPath();
  const state = useSetupWidgetState();
  const signalEnabled = useSignalEnabled();

  if (state.type === 'pending' || state.type === 'hidden') {
    return null;
  }

  if (state.type === 'error') {
    throw state.error; // Let the error be caught by the SuwaliErrorBoundary, which will show a fallback UI and report the error to Sentry.
  }

  const handleClickConnectButton = () => setSearchParams({ hubSettings: 'messaging-integrations' });

  if (state.type === 'continueSetup') {
    const handleContinueSetup = () => {
      if (hubId) localStorage.removeItem("hub_setup_skipped_" + hubId);
      navigate(hubPath('/hub/setup'));
    };

    return (
      <SetupCard
        icons={
          <div className={styles.setupPromptIcon}>
            <Icon id="hand_waving_color" aria-hidden />
          </div>
        }
        title={
          <FormattedMessage
            id="setupWidget.noContentTitle"
            defaultMessage="Your chatbot isn’t ready yet!"
            description="Title for the setup widget when hub setup has been skipped and is incomplete"
          />
        }
        text={
          <FormattedMessage
            id="setupWidget.noContentDescription"
            defaultMessage="Your chatbot needs content before it can answer questions."
            description="Description in the setup widget when the hub has no content added yet"
            tagName="p"
          />
        }
        action={
          <Button
            label={
              <FormattedMessage
                id="setupWidget.noContentCta"
                defaultMessage="Continue setup"
                description="CTA button in the setup widget to resume hub setup from the dashboard"
              />
            }
            size="small"
            onClick={handleContinueSetup}
          />
        }
      />
    );
  }

  if (state.type === 'goLive') {
    const { trialExpired } = state;

    return (
      <SetupCard
        icons={
          <div className={styles.messagingIntegrationIcons}>
            <Icon id="whatsapp" aria-label="WhatsApp" />
            <Icon inlineSvg id="telegram" aria-label="Telegram" />
            <Icon id="rcs" aria-label="RCS" />
            <Icon id="sms" aria-label="SMS" />
            {signalEnabled && <Icon id="signal" aria-label="Signal" />}
          </div>
        }
        title={
          <FormattedMessage
            id="setupWidget.goLiveTitle"
            defaultMessage="Go live!"
            description="Title for the setup widget when the hub has content but no messaging platform connected"
          />
        }
        text={
          trialExpired ? (
            <FormattedMessage
              id="global.trialEndedMessaging"
              defaultMessage="Your free trial has ended, so connecting to messaging platforms is not available."
              description="Reusable text explaining that messaging platforms cannot be connected because the free trial has expired"
              tagName="p"
            />
          ) : (
            signalEnabled ? (
              <FormattedMessage
                id="setupWidget.goLiveDescriptionWithSignal"
                defaultMessage="Connect a messaging platform like WhatsApp, Telegram, SMS, or Signal and your audience can have conversations with your chatbot."
                description="Description in the setup widget inviting the hub to connect a messaging platform, for hubs that can use Signal"
                tagName="p"
              />
            ) : (
              <FormattedMessage
                id="setupWidget.goLiveDescription"
                defaultMessage="Connect a messaging platform like WhatsApp, Telegram, or SMS and your audience can have conversations with your chatbot."
                description="Description in the setup widget inviting the hub to connect a messaging platform"
                tagName="p"
              />
            )
          )
        }
        action={trialExpired ? null : (
          <Button
            label={
              <FormattedMessage
                id="setupWidget.goLiveCta"
                defaultMessage="Connect a platform"
                description="CTA button in the setup widget to connect a messaging platform"
              />
            }
            size="small"
            onClick={handleClickConnectButton}
          />
        )}
      />
    );
  }

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.messagingPlatforms"
            defaultMessage="Messaging platforms"
            description="Reusable label for the list of messaging platforms connected to the hub"
          />
        }
        // Hiding is only offered once setup is fully connected. The continueSetup/goLive states
        // above render via SetupCard, which has no onHide affordance, so there's no way to dismiss
        // an incomplete setup prompt.
        onHide={onHide}
      />
      <Widget.Body>
        {state.integrations.filter((integration: MessagingIntegration) => signalEnabled || integration.platform !== 'signal').map((integration: MessagingIntegration) => (
          <IntegrationItem key={integration.id} integration={integration} />
        ))}
      </Widget.Body>
      <Widget.Footer
        label={
          <FormattedMessage
            id="global.messagingIntegrations"
            defaultMessage="Messaging integrations"
            description="Reusable label for the list of messaging integrations of the hub"
          />
        }
        onClick={handleClickConnectButton}
      />
    </Widget>
  );
};

export default SetupWidget;
