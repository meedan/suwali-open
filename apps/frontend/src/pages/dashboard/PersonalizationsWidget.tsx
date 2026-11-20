import { FormattedMessage } from "react-intl";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { fetchExternalResources } from "@services/ExternalResourcesService";

import { useSession } from "@root/SessionContext";

import { useHubPath } from "@hooks/useHubPath";

import { Widget } from "@ui-components/layout/Widget";

import styles from "./PersonalizationsWidget.module.css";
import PersonalizationsWidgetHint from "./PersonalizationsWidgetHint";

const PersonalizationsWidget = ({ onHide }: {
  onHide?: () => void,
}) => {
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const hub = useSession().currentHub();
  const hubId = hub?.id;

  const { data: resources } = useQuery({
    queryKey: [`/hubs/${hubId}/external-resources`],
    queryFn: () => fetchExternalResources(hubId!),
    enabled: Boolean(hubId),
  });

  const {
    name,
    description,
    tone,
    supported_languages,
  } = hub?.bot_attributes || {};

  return (
    <Widget>
      <Widget.Title
        title={
          <FormattedMessage
            id="global.personalizations"
            defaultMessage="Personalizations"
            description="Title for personalization/bot identity settings"
          />
        }
        onHide={onHide}
      />
      { name && <Widget.Headline title={name} />}
      <Widget.Body>
        <>
          { description && (
            <div className={styles.description}>
              {description}
            </div>
          )}
          {(!name || !description) && (
            <Link to={hubPath(name ? '/personalization/role' : '/personalization/name')} className={styles.missingNameOrDescription}>
              { !name && !description && (
                <FormattedMessage
                  id="personalizationsWidget.giveYourChatbotaName"
                  defaultMessage="Give your chatbot a name and describe the best use of your chatbot for your audience."
                  description="Title for personalization/bot identity settings"
                />
              )}
              { name && !description && (
                <FormattedMessage
                  id="personalizationsWidget.describeYourChatbot"
                  defaultMessage="Describe the best use of your chatbot for your audience."
                  description="Title for personalization/bot identity settings"
                />
              )}
            </Link>
          )}
          <PersonalizationsWidgetHint
            tone={tone}
            languages={supported_languages}
            resources={resources}
          />
        </>
      </Widget.Body>
      <Widget.Footer
        label={
          <FormattedMessage
            id="global.personalizations"
            defaultMessage="Personalizations"
            description="Title for personalization/bot identity settings"
          />
        }
        onClick={() => navigate(hubPath('/personalization'))}
      />
    </Widget>
  );
};

export default PersonalizationsWidget;
