import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import { getSignalLink, getTelegramLink, getWhatsappLink } from '@helpers/messaging-platform';
import { datetimeFormatOptions, formatMaxLimit, getActivityStatus, getStatusTooltip } from '@helpers/platform-admin';

import type { AdminHubDetail } from '@services/AdminService';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import { Can } from '@components/Can';

import SmsAccessToggle from './SmsAccessToggle';
import StatusValue from './StatusValue';

const messages = defineMessages({
  unrestricted: {
    id: 'admin.unrestricted',
    defaultMessage: 'unrestricted',
    description: 'Label shown in place of a numeric limit when there is no restriction on a hub',
  },
  editMessages: {
    id: 'admin.updateCustomLimitsModal.messagesTitle',
    defaultMessage: 'Update max monthly messages?',
    description: 'Title of the modal for updating the monthly messages custom limit',
  },
});

interface HubMessagingProps {
  hub: AdminHubDetail;
  onEditMessages: () => void;
}

const HubMessaging = ({ hub, onEditMessages }: HubMessagingProps) => {
  const intl = useIntl();
  const unlimitedLabel = intl.formatMessage(messages.unrestricted);
  const smsEnabled = hub.custom_limits?.sms === true;
  // SMS is sold only on these plans, so the toggle has no effect on the others (see Hub#can_use_sms?)
  const smsAvailable = ['standard', 'pro', 'enterprise'].includes(hub.plan);
  const suppressExternalData = hub.trial_active && hub.plan !== 'free_unrestricted';
  const whatsappLink = getWhatsappLink(hub.whatsapp_phone);
  const telegramLink = getTelegramLink(hub.telegram_username);
  const signalLink = getSignalLink(hub.signal_phone);
  const internalConvStatus = getActivityStatus(hub.last_internal_conversation_at);
  const externalConvStatus = getActivityStatus(hub.last_external_conversation_at);

  return (
    <section>
      <FormattedMessage
        id="admin.hubDetailMessagingTitle"
        defaultMessage="Messaging"
        description="Title for the messaging section on the hub detail page"
        tagName="h2"
      />
      <dl>
        <div>
          <FormattedMessage
            id="admin.hubDetailLastInternalConversation"
            defaultMessage="Last internal conversation"
            description="Label for the last internal conversation datetime on the hub detail page"
            tagName="dt"
          />
          <dd>
            <StatusValue
              status={internalConvStatus}
              tooltip={hub.last_internal_conversation_at
                ? (
                  <FormattedMessage
                    {...getStatusTooltip('conversations', internalConvStatus)}
                    values={{
                      date: (
                        <time
                          key="date"
                          dateTime={hub.last_internal_conversation_at}
                        >
                          <FormattedDate value={hub.last_internal_conversation_at} {...datetimeFormatOptions} />
                        </time>
                      )
                    }}
                  />
                )
                :
                  <FormattedMessage
                    id="admin.hubDetailNeverInternalConversation"
                    defaultMessage="No internal conversations have been recorded"
                    description="Tooltip shown on the last internal conversation row when no conversations have ever occurred"
                  />
              }
            >
              {hub.last_internal_conversation_at && (
                <FormattedDate value={hub.last_internal_conversation_at} {...datetimeFormatOptions} />
              )}
            </StatusValue>
          </dd>
        </div>
        <div>
          <FormattedMessage
            id="admin.hubsTableMonthlyContacts"
            defaultMessage="Active end-users"
            description="Column header for monthly active end-users in the hubs table"
            tagName="dt"
          />
          <dd>
            {suppressExternalData ? '—' : (
              <StatusValue status={hub.active_external_users_count === 0 ? 'pink' : null}>
                {hub.active_external_users_count.toLocaleString()}
              </StatusValue>
            )}
          </dd>
        </div>
        <div>
          <FormattedMessage
            id="admin.hubDetailMaxMessages"
            defaultMessage="Max monthly messages"
            description="Label for the monthly messages limit on the hub detail page"
            tagName="dt"
          />
          <dd>
            {formatMaxLimit(hub.max_messages, unlimitedLabel)}
          </dd>
          {hub.plan === 'enterprise' && (
            <Can action="IS_WRITE_ADMIN">
              <Button
                aria-label={intl.formatMessage(messages.editMessages)}
                title={intl.formatMessage(messages.editMessages)}
                iconLeft={<Icon aria-hidden id="pencil" />}
                size="small"
                themeMode
                variant="filled"
                onClick={onEditMessages}
              />
            </Can>
          )}
        </div>
        <div>
          <FormattedMessage
            id="admin.hubDetailLastExternalConversation"
            defaultMessage="Last external conversation"
            description="Label for the last external conversation datetime on the hub detail page"
            tagName="dt"
          />
          <dd>
            {suppressExternalData ? '—' : (
              <StatusValue
                status={externalConvStatus}
                tooltip={hub.last_external_conversation_at
                  ? (
                    <FormattedMessage
                      {...getStatusTooltip('conversations', externalConvStatus)}
                      values={{
                        date: (
                          <time
                            key="date"
                            dateTime={hub.last_external_conversation_at}
                          >
                            <FormattedDate value={hub.last_external_conversation_at} {...datetimeFormatOptions} />
                          </time>
                        )
                      }}
                    />
                  )
                  :
                   <FormattedMessage
                      id="admin.hubDetailNeverExternalConversation"
                      defaultMessage="No external conversations have been recorded"
                      description="Tooltip shown on the last external conversation row when no conversations have ever occurred"
                    />
                }
              >
                {hub.last_external_conversation_at
                  ? <FormattedDate value={hub.last_external_conversation_at} {...datetimeFormatOptions} />
                  : '—'
                }
              </StatusValue>
            )}
          </dd>
        </div>
        <div>
          <dt>WhatsApp</dt>
          <dd>
            {hub.whatsapp_phone
              ? <>{hub.whatsapp_phone}{whatsappLink && <> — <a href={whatsappLink} rel="noopener noreferrer" target="_blank">{whatsappLink}</a></>}</>
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Telegram</dt>
          <dd>
            {hub.telegram_username
              ? <>{hub.telegram_username}{telegramLink && <> — <a href={telegramLink} rel="noopener noreferrer" target="_blank">{telegramLink}</a></>}</>
              : '—'}
          </dd>
        </div>
        {hub.signal_phone && (
          <div>
            <dt>Signal</dt>
            <dd>
              {hub.signal_phone}{signalLink && <> — <a href={signalLink} rel="noopener noreferrer" target="_blank">{signalLink}</a></>}
            </dd>
          </div>
        )}
        <div>
          <dt>SMS</dt>
          <dd>
            <Can action="IS_WRITE_ADMIN">
              {(decision) => (decision.allowed && smsAvailable
                ? <SmsAccessToggle hubId={hub.id} currentLimits={hub.custom_limits} />
                : (smsEnabled && smsAvailable
                  ? <FormattedMessage id="global.enabled" defaultMessage="Enabled" description="Generic label indicating a feature is enabled" />
                  : <FormattedMessage id="global.disabled" defaultMessage="Disabled" description="Generic label indicating a feature is disabled" />))}
            </Can>
          </dd>
        </div>
      </dl>
    </section>
  );
};

export default HubMessaging;
