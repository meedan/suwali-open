import { FormattedMessage } from "react-intl";
import { useNavigate, useParams } from "react-router";

import type { ConversationFrom } from "@customTypes/conversation";

import { getLastPath } from "@helpers/lastPath";
import { getUserFallback } from "@helpers/user";

import { useSession } from "@root/SessionContext";

import { useHubPath } from "@hooks/useHubPath";

import {ToggleGroup, ToggleGroupItem} from "@ui-components/input/ToggleGroup";
import Avatar from "@ui-components/layout/Avatar";
import Icon from "@ui-components/layout/Icon";

import styles from './ConversationTypeSelector.module.css';

const ConversationTypeSelector = () => {
  const session = useSession();
  const hub = session.currentHub();
  const user = session.user;
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const params = useParams();

  const toggleValue = (params.from ?? 'audience') as ConversationFrom;

  const handleToggle = (newValue: ConversationFrom) => {
    // Navigating to the type's root would reload its list and reselect its conversation
    if (newValue === toggleValue) return;

    // Go straight to the type's last path, filters included, rather than letting its root redirect
    // there — the root has no filters, so its list and count would first show unfiltered
    const lastPath = getLastPath(`conversationsLastPath:${newValue}`, session.currentHubId());
    navigate(hubPath(lastPath ?? `/conversations/${newValue}`));
  };

  return (
    <div className={styles.conversationTypeSelectorWrapper}>
      <ToggleGroup
        size="medium"
        className={styles.toggleGroup}
        type="single"
        value={toggleValue}
      >
        <ToggleGroupItem
          className={styles.toggleGroupItem}
          iconLeft={<Icon className={styles.icon} id="users" />}
          value="audience"
          onClick={() => handleToggle('audience')}
        >
          <FormattedMessage
            id="global.audience"
            defaultMessage="Audience"
            description="Reusable label for the audience, the end-users who talk to the chatbot"
            tagName="label"
          />
        </ToggleGroupItem>
        <ToggleGroupItem
          className={styles.toggleGroupItem}
          iconLeft={
            <Avatar
              editor
              iconLayout
              name={hub?.name}
              picture={hub?.profile_picture_url}
              fallback={hub?.name.substring(0, 1)}
            />
          }
          value="team"
          onClick={() => handleToggle('team')}
        >
          <FormattedMessage
            id="global.team"
            defaultMessage="Team"
            description="Reusable generic label for a hub’s team, e.g. as a conversation audience filter"
            tagName="label"
          />
        </ToggleGroupItem>
        <ToggleGroupItem
          className={styles.toggleGroupItem}
          iconLeft={
            <Avatar
              editor
              iconLayout
              name={user?.name}
              picture={user?.profile_picture_url}
              fallback={getUserFallback(user?.name, user?.email)}
            />
          }
          value="me"
          onClick={() => handleToggle('me')}
        >
          <FormattedMessage
            id="global.you"
            defaultMessage="You"
            description="Reusable generic label for the current user, e.g. as a conversation audience filter"
            tagName="label"
          />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};

export default ConversationTypeSelector;
