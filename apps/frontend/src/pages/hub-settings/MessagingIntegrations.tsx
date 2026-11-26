import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getStatusTone, type StatusTone } from '@helpers/messaging-platform';
import { US_STATES } from '@helpers/us-states';

import { fetchAbout } from '@services/AboutService';
import { fetchIntegrations } from '@services/HubService';
import { connectMessagingIntegration, disconnectMessagingIntegration } from '@services/MessagingIntegrationsService';

import { HttpError, sanitizeApiErrors } from '@root/NetworkLayer';
import { useSession } from '@root/SessionContext';

import { SIGNAL_FEATURE_FLAG } from '@hooks/useSignalEnabled';
import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import TextInput from '@ui-components/input/TextInput';
import HintBox from '@ui-components/layout/HintBox';
import Icon from '@ui-components/layout/Icon';
import { PollingLoading } from '@ui-components/layout/LoadingIndicator';

import { Can } from '@components/Can';
import FeatureFlag from '@components/FeatureFlag';

import TrialMessagingBanner from '@trial-banners/TrialMessagingBanner';

import settingsStyles from '@pages/Settings.module.css';

import ConfirmDisconnectIntegrationModal from './ConfirmDisconnectIntegrationModal';
import styles from './MessagingIntegrations.module.css';
import SignalIntegration from './SignalIntegration';
import TemplateStatusBadge from './TemplateStatusBadge';
import WhatsappEmbeddedSignup from './WhatsappEmbeddedSignup';

type SmsNumberType = "tollfree" | "local";

const SMS_AREA_CODE_OPTION = "area_code";

const TONE_CLASSES: Record<StatusTone, string> = {
  green: styles.green,
  yellow: styles.yellow,
  pink: styles.pink,
};

const messages = defineMessages({
  botToken: {
    id: 'messagingIntegrations.bot',
    defaultMessage: 'Bot token',
    description: 'Placeholder that shows the user needs to enter the API token for this chatbot'
  },
  integrationDisconnectError: {
    id: 'messagingIntegrations.integrationDisconnectError',
    defaultMessage: 'Something went wrong while disconnecting the integration. Please try again.',
    description: 'Error message shown when disconnecting a messaging integration fails'
  },
  smsNumberTypeTollfree: {
    id: 'messagingIntegrations.smsNumberTypeTollfree',
    defaultMessage: 'Toll-free number',
    description: 'Option label for provisioning a US toll-free SMS number'
  },
  smsNumberTypeLocal: {
    id: 'messagingIntegrations.smsNumberTypeLocal',
    defaultMessage: 'Local number (10DLC)',
    description: 'Option label for provisioning a US local (10DLC) SMS number'
  },
  smsConnectError: {
    id: 'messagingIntegrations.smsConnectError',
    defaultMessage: 'Something went wrong while connecting SMS. Please try again.',
    description: 'Fallback error message shown when connecting an SMS integration fails'
  },
  telegramConnectError: {
    id: 'messagingIntegrations.telegramConnectError',
    defaultMessage: 'Something went wrong while connecting Telegram. Please double-check your bot token and try again.',
    description: 'Fallback error message shown when connecting a Telegram integration fails'
  },
  whatsappConnectError: {
    id: 'messagingIntegrations.whatsappConnectError',
    defaultMessage: 'Something went wrong while connecting WhatsApp. Please try again.',
    description: 'Fallback error message shown when connecting a WhatsApp integration fails'
  },
});

const MessagingIntegrations = () => {
  const intl = useIntl();
  const [showDisconnectModalFor, setShowDisconnectModalFor] = useState("");
  const [saving, setSaving] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramError, setTelegramError] = useState("");
  const [smsNumberType, setSmsNumberType] = useState<SmsNumberType>("tollfree");
  const [smsState, setSmsState] = useState("any");
  const [smsAreaCode, setSmsAreaCode] = useState("");
  const [smsError, setSmsError] = useState("");
  const session = useSession();
  const hubId = session.currentHubId();
  const { toast } = useToast();

  const { data, error, isPending } = useQuery({
    queryKey: [`/hubs/${hubId}/messaging-integrations`],
    queryFn: () => fetchIntegrations(hubId!),
    enabled: Boolean(hubId),
    // A Signal account is linked when its QR code is scanned on the phone, so poll until that happens
    refetchInterval: (query) => (
      query.state.data?.some((integration) => integration.signal_link?.status === 'pending') ? 3000 : false
    ),
  });

  const queryClient = useQueryClient();
  const refetch = () => queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/messaging-integrations`] });

  const integrations = useMemo(() => data || [], [data]);
  const telegramIntegration = integrations.find(integration => integration.platform === "telegram");
  const whatsappIntegration = integrations.find(integration => integration.platform === "whatsapp");
  const smsIntegration = integrations.find(integration => integration.platform === "sms");
  const signalIntegration = integrations.find(integration => integration.platform === "signal");
  const templateStatuses = whatsappIntegration?.template_statuses || [];
  const templateLanguages = [...new Set(templateStatuses.map((template) => template.language))];
  const templateTones = [...new Set(templateStatuses.map((template) => template.tone))];

  const { data: aboutData } = useQuery({
    queryKey: ['/about'],
    queryFn: fetchAbout,
  });

  // Only US is offered for now, so the frontend pins the country; the available number types
  // still come from the backend (/about) so new types need no frontend change.
  const smsCountry = "US";
  const smsNumberTypes = aboutData?.sms_countries?.find((country) => country.code === smsCountry)?.number_types || ["tollfree"];

  const smsNumberTypeLabel = (type: string) => {
    if (type === "tollfree") return intl.formatMessage(messages.smsNumberTypeTollfree);
    if (type === "local") return intl.formatMessage(messages.smsNumberTypeLocal);
    return type;
  };

  const languageName = (code: string) => {
    const lang = aboutData?.languages?.find(l => l.code === code);
    return lang?.name || code;
  };

  const statusBadgeClass = (status: string | null | undefined) => {
    const tone = getStatusTone(status);
    return clsx(styles.statusBadge, tone && TONE_CLASSES[tone]);
  };

  const handleConfirmDisconnect = (platform: string) => {
    setShowDisconnectModalFor(platform);
  };

  const handleConnectTelegram = async () => {
    setSaving("telegram");
    setTelegramError("");
    try {
      const data = await connectMessagingIntegration(hubId!, "telegram", { telegram_bot_token: telegramBotToken });
      if (data.id) {
        refetch();
      } else {
        setTelegramError(intl.formatMessage(messages.telegramConnectError));
      }
    } catch (error) {
      const message = error instanceof HttpError ? sanitizeApiErrors(error.data) : null;
      setTelegramError(message || intl.formatMessage(messages.telegramConnectError));
    } finally {
      setSaving("");
    }
  };

  const handleConnectWhatsapp = async () => {
    setSaving("whatsapp");
    try {
      const data = await connectMessagingIntegration(hubId!, "whatsapp");
      if (data.id) {
        refetch();
      }
    } catch (error) {
      const message = error instanceof HttpError ? sanitizeApiErrors(error.data) : null;
      toast('error', message || intl.formatMessage(messages.whatsappConnectError));
    } finally {
      setSaving("");
    }
  };

  const handleConnectSms = async () => {
    setSaving("sms");
    setSmsError("");
    try {
      const params: Record<string, string> = { sms_country: smsCountry, sms_number_type: smsNumberType };
      if (smsNumberType === "local" && smsState === SMS_AREA_CODE_OPTION) {
        params.sms_area_code = smsAreaCode.trim();
      } else if (smsNumberType === "local" && smsState !== "any") {
        params.sms_state = smsState;
      }
      const data = await connectMessagingIntegration(hubId!, "sms", params);
      if (data.id) {
        refetch();
      } else {
        setSmsError(intl.formatMessage(messages.smsConnectError));
      }
    } catch (error) {
      const message = error instanceof HttpError ? sanitizeApiErrors(error.data) : null;
      setSmsError(message || intl.formatMessage(messages.smsConnectError));
    } finally {
      setSaving("");
    }
  };

  const handleDisconnectIntegration = async () => {
    let integration = null;
    if (showDisconnectModalFor === "telegram") {
      integration = telegramIntegration;
    } else if (showDisconnectModalFor === "whatsapp") {
      integration = whatsappIntegration;
    } else if (showDisconnectModalFor === "sms") {
      integration = smsIntegration;
    } else if (showDisconnectModalFor === "signal") {
      integration = signalIntegration;
    }
    try {
      if (!integration) throw new Error('No messaging integration to disconnect');
      await disconnectMessagingIntegration(integration.id);
      refetch();
    } catch {
      toast('error', intl.formatMessage(messages.integrationDisconnectError));
    }
    setShowDisconnectModalFor("");
  };

  if (isPending) {
    return (
      <FormattedMessage
        id="global.messagingIntegrationsloadingIntegrations"
        defaultMessage="Loading messaging integrations…"
        description="Message displayed when messaging integrations list is loading."
        tagName="p"
      />
    );
  }

  if (error) {
    return (
      <FormattedMessage
        id="global.messagingIntegrationserrorLoading"
        defaultMessage="Could not load messaging integrations. Please try again later."
        description="Message displayed when messaging integrations can’t be listed."
        tagName="p"
      />
    );
  }

  return (
    <div className={styles.messagingIntegrations}>
      <div className={styles.introduction}>
        <FormattedMessage
          id="global.messagingIntegrationsintegrationsDescription"
          defaultMessage="Your audience can chat with your chatbot on a variety of messaging apps and platforms. Connect one or many integrations below and send your audience contact information."
          description="Description on why to connect to messaging platforms"
          tagName="p"
        />
      </div>
      <Can action="MANAGE_MESSAGING_INTEGRATION">
        {(decision) => {
          if (!decision.allowed && decision.reasons && decision.reasons.includes('trial_expired')) {
            return <TrialMessagingBanner />;
          }
          if (!decision.allowed && decision.reasons && decision.reasons.includes('insufficient_permissions')) {
            return (
              <FormattedMessage
                id="global.messagingIntegrationsNoPermission"
                defaultMessage="You don’t have permission to manage message integrations. Contact an administrator of your hub."
                description="Message displayed on Messaging Integrations page when user does not have permission"
              />
            );
          }
          if (decision.allowed) {
            return (
              <div>
                <div>
                  <h2><Icon inlineSvg id="telegram" /> <span>Telegram</span></h2>
                  { telegramIntegration ? (
                    <div className={styles.connected}>
                      <FormattedMessage
                        id="global.messagingIntegrationstelegramConnected"
                        defaultMessage="{icon} Connected account: {accountName}"
                        description="Information for connected Telegram account on Messaging Integrations page"
                        values={{
                          accountName: <strong key="accountName">{telegramIntegration.bot_name}</strong>,
                          icon: <Icon key="icon" id="check_seal_filled" />,
                        }}
                        tagName="span"
                      />
                      <FormattedMessage
                        id="global.messagingIntegrationstelegramBotLink"
                        defaultMessage="{icon} View in Telegram: {telegramBotLink}"
                        description="Link to go to the chatbot on telegram"
                        values={{
                          telegramBotLink: (
                            <strong key="telegramBotLink">
                              <a href={`https://t.me/${telegramIntegration.bot_username}`} target="_blank" rel="noopener noreferrer">
                                @{telegramIntegration.bot_username}
                              </a>
                            </strong>
                          ),
                          icon: <Icon key="icon" id="arrow_square_out_filled" />,
                        }}
                        tagName="span"
                      />
                      <Button
                        onClick={() => { handleConfirmDisconnect("telegram"); }}
                        label={
                          <FormattedMessage
                            id="global.messagingIntegrationsdisconnectTelegram"
                            defaultMessage="Disconnect Telegram"
                            description="Button label for disconnecting a messaging integration"
                          />
                        }
                        size="small"
                        themeMode
                      />
                    </div>
                  ) : (
                    <>
                      <HintBox
                        type="info"
                        body={
                          <FormattedMessage
                            id="global.messagingIntegrationstelegramIntro"
                            defaultMessage="Telegram is known for its large group capacity, customizable bots, and secret chats with self-destruct timers."
                            description="Intro description for Telegram on Messaging Integrations page"
                            tagName="span"
                          />
                        }
                      />
                      <br />
                      <fieldset>
                        <TextInput
                          id="telegramBotToken"
                          error={telegramError}
                          label={
                            <FormattedMessage
                              id="global.messagingIntegrationstelegramIntroContinued"
                              defaultMessage="Simple to configure, it just requires a <tokenLink>Telegram bot token</tokenLink>."
                              description="Intro description for what is required to connect Telegram as an integration; the link opens Telegram’s instructions for creating a bot token"
                              tagName="p"
                              values={{
                                tokenLink: msg => (
                                  <a key="tokenLink" href="https://core.telegram.org/bots#how-do-i-create-a-bot" target="_blank" rel="noopener noreferrer">
                                    {msg}
                                  </a>
                                ),
                              }}
                            />
                          }
                          placeholder={intl.formatMessage(messages.botToken)}
                          value={telegramBotToken}
                          onChange={(e) => {
                            setTelegramError("");
                            setTelegramBotToken(e.target.value);
                          }}
                          required
                          type="text"
                          size="large"
                        />
                      </fieldset>
                      <div className={settingsStyles.buttonWrapper}>
                        <Button
                          disabled={!telegramBotToken || saving === 'telegram'}
                          label={
                            saving === 'telegram' ?
                              <FormattedMessage
                                id="global.messagingIntegrationsconnectingTelegram"
                                defaultMessage="Connecting Telegram…"
                                description="Button label displayed while connecting a Telegram integration after entering the chatbot token"
                              /> :
                              <FormattedMessage
                                id="global.messagingIntegrationsconnectTelegram"
                                defaultMessage="Connect Telegram"
                                description="Button label for connecting a Telegram integration after entering the chatbot token"
                              />
                          }
                          onClick={handleConnectTelegram}
                          size="small"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <h2><Icon id="whatsapp" /> <span>WhatsApp</span></h2>
                  { whatsappIntegration ? (
                    <div className={whatsappIntegration.phone_number ? styles.connected : styles.pending}>
                      { whatsappIntegration.phone_number ?
                        <>
                          <FormattedMessage
                            id="global.messagingIntegrationswhatsappConnected"
                            defaultMessage="{icon} Connected phone number: {phoneNumber}"
                            description="Information for connected WhatsApp account on Messaging Integrations page"
                            values={{
                              phoneNumber: <strong key="phoneNumber">{whatsappIntegration.phone_number}</strong>,
                              icon: <Icon key="icon" id="check_seal_filled" />,
                            }}
                            tagName="span"
                          />
                          <FormattedMessage
                            id="global.messagingIntegrationswhatsappBotLink"
                            defaultMessage="{icon} View in WhatsApp: {whatsappBotLink}"
                            description="Link to go to the chatbot on WhatsApp"
                            values={{
                              whatsappBotLink: (
                                <strong key="whatsappBotLink">
                                  <a href={`https://wa.me/${whatsappIntegration.phone_number.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer">
                                    {whatsappIntegration.phone_number}
                                  </a>
                                </strong>
                              ),
                              icon: <Icon key="icon" id="arrow_square_out_filled" />,
                            }}
                            tagName="span"
                          />
                          {whatsappIntegration.phone_number_status && (
                            <div className={styles.statusContainer}>
                              <FormattedMessage
                                id="global.messagingIntegrationswhatsappStatus"
                                defaultMessage="Account Status (visit your WhatsApp Business page for more information):"
                                description="Label for WhatsApp account status section"
                                tagName="span"
                              />
                              {whatsappIntegration.business_verification_status && whatsappIntegration.business_verification_status !== 'VERIFIED' && (
                                <HintBox
                                  type="warning"
                                  body={
                                    <FormattedMessage
                                      id="global.messagingIntegrationswhatsappBusinessVerificationNotice"
                                      defaultMessage="Your Meta business account is not verified yet. <verificationLink>Start the business verification process</verificationLink> in the Meta Business Manager Security Center."
                                      description="Notice with a link to Meta Business Manager shown when the WhatsApp business account has not completed business verification"
                                      values={{
                                        verificationLink: msg => (
                                          <a key="verificationLink" href="https://business.facebook.com/settings/security" target="_blank" rel="noopener noreferrer">
                                            {msg}
                                          </a>
                                        ),
                                      }}
                                    />
                                  }
                                />
                              )}
                              <div className={styles.statusBadges}>
                                {whatsappIntegration.phone_number_status.quality_rating && (
                                  <span className={statusBadgeClass(whatsappIntegration.phone_number_status.quality_rating)}>
                                    <FormattedMessage
                                      id="global.messagingIntegrationswhatsappQualityRating"
                                      defaultMessage="Quality: {rating}"
                                      description="WhatsApp quality rating display"
                                      values={{ rating: whatsappIntegration.phone_number_status.quality_rating }}
                                    />
                                  </span>
                                )}
                                {whatsappIntegration.phone_number_status.status && (
                                  <span className={statusBadgeClass(whatsappIntegration.phone_number_status.status)}>
                                    <FormattedMessage
                                      id="global.messagingIntegrationswhatsappConnectionStatus"
                                      defaultMessage="Status: {status}"
                                      description="WhatsApp connection status display"
                                      values={{ status: whatsappIntegration.phone_number_status.status }}
                                    />
                                  </span>
                                )}
                                {whatsappIntegration.phone_number_status.name_status && (
                                  <span className={statusBadgeClass(whatsappIntegration.phone_number_status.name_status)}>
                                    <FormattedMessage
                                      id="global.messagingIntegrationswhatsappNameStatus"
                                      defaultMessage="Name status: {status}"
                                      description="WhatsApp account name status"
                                      values={{ status: whatsappIntegration.phone_number_status.name_status }}
                                    />
                                  </span>
                                )}
                                {whatsappIntegration.business_verification_status && (
                                  <span className={statusBadgeClass(whatsappIntegration.business_verification_status)}>
                                    <FormattedMessage
                                      id="global.messagingIntegrationswhatsappBusinessVerificationStatus"
                                      defaultMessage="Business verification: {status}"
                                      description="WhatsApp business verification status display"
                                      values={{ status: whatsappIntegration.business_verification_status }}
                                    />
                                  </span>
                                )}
                                {whatsappIntegration.phone_number_status.account_mode && (
                                  <span className={styles.statusBadge}>
                                    <FormattedMessage
                                      id="global.messagingIntegrationswhatsappAccountMode"
                                      defaultMessage="Mode: {mode}"
                                      description="WhatsApp account mode display"
                                      values={{ mode: whatsappIntegration.phone_number_status.account_mode }}
                                    />
                                  </span>
                                )}
                              </div>
                              <FormattedMessage
                                id="global.messagingIntegrationswhatsappTemplateStatusTitle"
                                defaultMessage="Template Status (visit your WhatsApp Business page for more information):"
                                description="Label for WhatsApp template status section"
                                tagName="span"
                              />
                              {templateStatuses.length > 0 && (
                                <div className={styles.statusBadges}>
                                  <table className={styles.templateTable}>
                                    <thead>
                                      <tr>
                                        <th />
                                        {templateTones.map((tone) => (
                                          <th key={tone}>{tone}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {templateLanguages.map((language) => (
                                        <tr key={language}>
                                          <th>{languageName(language)}</th>
                                          {templateTones.map((tone) => {
                                            const templateStatus = templateStatuses.find((template) => template.language === language && template.tone === tone);
                                            return (
                                              <td key={tone}>
                                                {templateStatus?.status ? (
                                                  <TemplateStatusBadge
                                                    status={templateStatus.status}
                                                    category={templateStatus.category}
                                                    className={statusBadgeClass(templateStatus.status)}
                                                  />
                                                ) : (
                                                  '—'
                                                )}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                          <Button
                            onClick={() => { handleConfirmDisconnect("whatsapp"); }}
                            label={
                              <FormattedMessage
                                id="global.messagingIntegrationsdisconnectWhatsapp"
                                defaultMessage="Disconnect WhatsApp"
                                description="Button label for disconnecting a messaging integration"
                              />
                            }
                            size="small"
                            themeMode
                          />
                        </> :
                        <>
                          <div className={styles.waiting}>
                            <PollingLoading />
                            <FormattedMessage
                              id="global.messagingIntegrationswaitingWhatsapp"
                              defaultMessage="Waiting to hear from your WhatsApp business account…"
                              description="Waiting message while the whatsapp setup is in process"
                              tagName="em"
                            />
                          </div>
                          <div className={styles.whatsAppButtons}>
                            <WhatsappEmbeddedSignup messagingIntegration={whatsappIntegration} onComplete={refetch} />
                            <Button
                              onClick={() => { handleConfirmDisconnect("whatsapp"); }}
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
                          </div>
                        </>
                      }
                    </div>
                  ) : (
                    <>
                      <HintBox
                        type="info"
                        body={
                          <FormattedMessage
                            id="global.messagingIntegrationswhatsappIntro"
                            defaultMessage="WhatsApp is widely used for its end-to-end encrypted messaging and deep integration with phone contacts."
                            description="Intro description for WhatsApp on Messaging Integrations page"
                            tagName="span"
                          />
                        }
                      />
                      <br />
                      <FormattedMessage
                        id="global.messagingIntegrationswhatsapp"
                        defaultMessage="<learnMoreLink>To connect WhatsApp</learnMoreLink>, you will need:"
                        description="Description for WhatsApp on Messaging Integrations page"
                        tagName="p"
                        values={{
                          learnMoreLink: msg => (
                            <a key="learnMoreLink" href="https://developers.facebook.com/docs/whatsapp/embedded-signup/" target="_blank" rel="noopener noreferrer">
                              {msg}
                            </a>
                          ),
                        }}
                      />
                      <ul className={styles.whatsappList}>
                        <FormattedMessage
                          id="global.messagingIntegrationswhatsAppLoginRequirement"
                          defaultMessage="Sign in to your Facebook or Meta business account"
                          description="Message to user indicating that they will need to login to their Facebook account to continue"
                          tagName="li"
                        />
                        <FormattedMessage
                          id="global.messagingIntegrationswhatsAppWabaRequirement"
                          defaultMessage="Select or create a WhatsApp Business Account (WABA)"
                          description="Message to user indicating that they will need to select or create a WhatsApp Business account to continue"
                          tagName="li"
                        />
                        <FormattedMessage
                          id="global.messagingIntegrationswhatsAppVerifiedRequirement"
                          defaultMessage="Verify the WhatsApp phone number for your audience to chat with"
                          description="Message to user indicating that they will need to have their phone number verified with WhatsApp to continue"
                          tagName="li"
                        />
                      </ul>
                      <div className={settingsStyles.buttonWrapper}>
                        <Button
                          disabled={saving === 'whatsapp'}
                          label={
                            saving === 'whatsapp' ?
                              <FormattedMessage
                                id="global.messagingIntegrationsconnectingWhatsapp"
                                defaultMessage="Connecting WhatsApp…"
                                description="Button label displayed while connecting a WhatsApp integration"
                              /> :
                              <FormattedMessage
                                id="global.messagingIntegrationsconnectWhatsapp"
                                defaultMessage="Connect WhatsApp"
                                description="Button label for connecting a WhatsApp integration after entering"
                              />
                          }
                          onClick={handleConnectWhatsapp}
                          size="small"
                        />
                      </div>
                    </>
                  )}
                </div>

                <FeatureFlag flag={SIGNAL_FEATURE_FLAG}>
                <div>
                  <h2><Icon id="signal" /> <span>Signal</span></h2>
                  <SignalIntegration
                    hubId={hubId!}
                    integration={signalIntegration}
                    onChange={refetch}
                    onDisconnect={() => { handleConfirmDisconnect("signal"); }}
                  />
                </div>
                </FeatureFlag>

                <Can action="MANAGE_SMS">
                <div>
                  <h2><Icon id="sms" /> <span>SMS</span></h2>
                  { smsIntegration ? (
                    <div className={styles.connected}>
                      <FormattedMessage
                        id="global.messagingIntegrationssmsConnected"
                        defaultMessage="{icon} Connected number: {phoneNumber} ({country})"
                        description="Information for a connected SMS number on Messaging Integrations page"
                        values={{
                          phoneNumber: <strong key="phoneNumber">{smsIntegration.phone_number}</strong>,
                          country: smsIntegration.country,
                          icon: <Icon key="icon" id="check_seal_filled" />,
                        }}
                        tagName="span"
                      />
                      {smsIntegration.rcs_enabled && (
                        <div className={styles.statusBadges}>
                          <span className={clsx(styles.statusBadge, styles.green)}>
                            <FormattedMessage
                              id="global.messagingIntegrationssmsRcsEnabled"
                              defaultMessage="RCS enabled"
                              description="Badge shown on the SMS integration when RCS (rich messaging) is enabled for the number"
                            />
                          </span>
                        </div>
                      )}
                      {smsIntegration.registration_type && (
                        <div className={styles.statusContainer}>
                          <FormattedMessage
                            id="global.messagingIntegrationssmsRegistrationStatus"
                            defaultMessage="Registration status ({type}):"
                            description="Label for the SMS registration status section"
                            values={{ type: smsIntegration.registration_type }}
                            tagName="span"
                          />
                          <div className={styles.statusBadges}>
                            <span className={statusBadgeClass(smsIntegration.registration_status || 'unregistered')}>
                              {smsIntegration.registration_status || 'unregistered'}
                            </span>
                          </div>
                          {smsIntegration.registration_status !== 'approved' && (
                            <FormattedMessage
                              id="global.messagingIntegrationssmsRegistrationPending"
                              defaultMessage="Two-way SMS becomes active once registration is approved."
                              description="Note shown while an SMS number’s registration is not yet approved"
                              tagName="em"
                            />
                          )}
                        </div>
                      )}
                      {smsIntegration.opt_in_url && (
                        <div className={styles.statusContainer}>
                          <FormattedMessage
                            id="global.messagingIntegrationssmsOptInPage"
                            defaultMessage="Opt-in page: {link}"
                            description="Label and link to the public SMS opt-in page, which explains how people consent to receive SMS messages from this number"
                            values={{
                              link: <a key="link" href={smsIntegration.opt_in_url} target="_blank" rel="noopener noreferrer">{smsIntegration.opt_in_url}</a>,
                            }}
                            tagName="span"
                          />
                        </div>
                      )}
                      <Button
                        onClick={() => { handleConfirmDisconnect("sms"); }}
                        label={
                          <FormattedMessage
                            id="global.messagingIntegrationsdisconnectSms"
                            defaultMessage="Disconnect SMS"
                            description="Button label for disconnecting a messaging integration"
                          />
                        }
                        size="small"
                        themeMode
                      />
                    </div>
                  ) : (
                    <>
                      <HintBox
                        type="info"
                        body={
                          <FormattedMessage
                            id="global.messagingIntegrationssmsIntro"
                            defaultMessage="SMS reaches anyone with a mobile number, no app required. We’ll provision a dedicated number for your audience to text. Currently available in the United States only."
                            description="Intro description for SMS on Messaging Integrations page"
                            tagName="span"
                          />
                        }
                      />
                      <br />
                      <fieldset>
                        <Select
                          id="smsNumberType"
                          error={smsError}
                          label={
                            <FormattedMessage
                              id="global.messagingIntegrationssmsNumberTypeLabel"
                              defaultMessage="Number type"
                              description="Label for the SMS number type selector"
                            />
                          }
                          value={smsNumberType}
                          onValueChange={(value) => { setSmsError(""); setSmsNumberType(value as SmsNumberType); }}
                          size="large"
                        >
                          {smsNumberTypes.map((type) => (
                            <SelectItem key={type} value={type}>{smsNumberTypeLabel(type)}</SelectItem>
                          ))}
                        </Select>
                        {smsNumberType === 'local' && (
                          <Select
                            id="smsState"
                            label={
                              <FormattedMessage
                                id="global.messagingIntegrationssmsStateLabel"
                                defaultMessage="State"
                                description="Label for the SMS state selector shown for local numbers"
                              />
                            }
                            value={smsState}
                            onValueChange={setSmsState}
                            size="large"
                          >
                            <SelectItem value="any">
                              <FormattedMessage
                                id="messagingIntegrations.smsStateAny"
                                defaultMessage="Any state"
                                description="Option label for provisioning a local SMS number without a state preference"
                              />
                            </SelectItem>
                            <SelectItem value={SMS_AREA_CODE_OPTION}>
                              <FormattedMessage
                                id="messagingIntegrations.smsStateAreaCode"
                                defaultMessage="Specific area code…"
                                description="Option label in the SMS state selector that reveals a field to enter an area code instead of picking a state"
                              />
                            </SelectItem>
                            {US_STATES.map((state) => (
                              <SelectItem key={state.code} value={state.code}>{state.name}</SelectItem>
                            ))}
                          </Select>
                        )}
                        {smsNumberType === 'local' && smsState === SMS_AREA_CODE_OPTION && (
                          <TextInput
                            id="smsAreaCode"
                            label={
                              <FormattedMessage
                                id="global.messagingIntegrationssmsAreaCodeLabel"
                                defaultMessage="Area code"
                                description="Label for the field to enter the area code of the local SMS number to provision"
                              />
                            }
                            placeholder="718"
                            value={smsAreaCode}
                            onChange={(e) => { setSmsError(""); setSmsAreaCode(e.target.value); }}
                            inputProps={{ inputMode: 'numeric', maxLength: 3 }}
                            size="large"
                          />
                        )}
                      </fieldset>
                      <div className={settingsStyles.buttonWrapper}>
                        <Button
                          disabled={saving === 'sms' || (smsNumberType === 'local' && smsState === SMS_AREA_CODE_OPTION && !/^\d{3}$/.test(smsAreaCode.trim()))}
                          label={
                            saving === 'sms' ?
                              <FormattedMessage
                                id="global.messagingIntegrationsconnectingSms"
                                defaultMessage="Connecting SMS…"
                                description="Button label displayed while connecting an SMS integration"
                              /> :
                              <FormattedMessage
                                id="global.messagingIntegrationsconnectSms"
                                defaultMessage="Connect SMS"
                                description="Button label for connecting an SMS integration after choosing a number type"
                              />
                          }
                          onClick={handleConnectSms}
                          size="small"
                        />
                      </div>
                    </>
                  )}
                </div>
                </Can>
              </div>
            );
          }
          return null;
        }}
      </Can>
      <ConfirmDisconnectIntegrationModal open={Boolean(showDisconnectModalFor)} onConfirm={handleDisconnectIntegration} onCancel={() => { setShowDisconnectModalFor(""); }} />
    </div>
  );
};

export default MessagingIntegrations;
