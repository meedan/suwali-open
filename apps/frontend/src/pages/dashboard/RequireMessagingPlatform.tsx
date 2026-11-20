import { FormattedMessage } from 'react-intl';
import { useSearchParams } from 'react-router';

import { useHubSetupTasks } from '@hooks/useHubSetupTasks';
import { useSignalEnabled } from '@hooks/useSignalEnabled';

import HintBox from '@ui-components/layout/HintBox';
import { Widget } from '@ui-components/layout/Widget';

// Dashboard widgets that count what the audience asked have nothing to show until a messaging
// platform is connected, so they render this instead: why the widget is empty, and the way out.
const RequireMessagingPlatform = ({ children }: {
  children: React.ReactNode,
}) => {
  const setSearchParams = useSearchParams()[1];
  const { messagingPlatformConnected, isPending } = useHubSetupTasks();
  const signalEnabled = useSignalEnabled();

  if (isPending) return null;
  if (messagingPlatformConnected) return children;

  return (
    <>
      <Widget.Body>
        <HintBox
          type="warning"
          body={
            signalEnabled ? (
              <FormattedMessage
                id="global.connectPlatformHintWithSignal"
                defaultMessage="Connect a messaging platform like <strong>WhatsApp</strong>, <strong>Telegram</strong>, <strong>SMS</strong>, or <strong>Signal</strong> and your audience can ask your chatbot questions."
                description="Hint shown when no platforms are connected, for hubs that can use Signal"
                values={{ strong: msg => <strong key="strong">{msg}</strong> }}
                tagName="span"
              />
            ) : (
              <FormattedMessage
                id="global.connectPlatformHint"
                defaultMessage="Connect a messaging platform like <strong>WhatsApp</strong>, <strong>Telegram</strong>, or <strong>SMS</strong> and your audience can ask your chatbot questions."
                description="Hint shown when no platforms are connected"
                values={{ strong: msg => <strong key="strong">{msg}</strong> }}
                tagName="span"
              />
            )
          }
        />
      </Widget.Body>
      <Widget.Footer
        label={
          <FormattedMessage
            id="global.messagingIntegrations"
            defaultMessage="Messaging integrations"
            description="Reusable label for the list of messaging integrations of the hub"
          />
        }
        onClick={() => setSearchParams({ hubSettings: 'messaging-integrations' })}
      />
    </>
  );
};

export default RequireMessagingPlatform;
