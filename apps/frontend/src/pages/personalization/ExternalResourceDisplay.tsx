import clsx from 'clsx';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { ExternalResource, Scenario } from '@customTypes/external-resource';

import { getResourceIcon } from "@helpers/externalResource";

import Icon from '@ui-components/layout/Icon';
import ParsedText from '@ui-components/layout/ParsedText';

import styles from './Personalization.module.css';
import { scenarioLabels } from './scenarioLabels';

const messages = defineMessages({
  usedInScenarios: {
    id: 'global.usedInScenarios',
    defaultMessage: '<strong>{count}</strong> {count, plural, one {Scenario} other {Scenarios}}:',
    description: 'Label showing how many scenarios use this resource',
  },
});

type ExternalResourceDisplayProps = {
  resource: ExternalResource;
  onEdit?: () => void;
};

const ExternalResourceDisplay = ({ resource, onEdit }: ExternalResourceDisplayProps) => {
  const intl = useIntl();

  const getScenarioLabel = (scenario: Scenario) => intl.formatMessage(scenarioLabels[scenario]);

  const content = (
    <>
      <div className={styles.personalizationIconWrapper}>
        <Icon id={getResourceIcon(resource)} aria-hidden />
      </div>
      <div className={styles.listPersonalizationContentWrapper}>
        <h3>{resource.title}</h3>
        {resource.description && (
          <p>
            <ParsedText text={resource.description} />
          </p>
        )}
        <div>
          <FormattedMessage
            {...messages.usedInScenarios}
            tagName="p"
            values={{ count: resource.scenarios.length, strong: (chunks) => <strong key="strong">{chunks}</strong> }}
          />
          <ul className={styles.bulletList}>
            {resource.scenarios.map(scenario => (
              <li key={scenario}>
                <strong>{getScenarioLabel(scenario)}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {onEdit &&
        <div className={styles.listPersonalizationEditCta}>
          <FormattedMessage
            id="global.editResource"
            defaultMessage="Edit resource"
            description="Generic label for titles or buttons indicating an edit action for resources"
            tagName="span"
          />
        </div>
      }
    </>
  );

  if (onEdit) {
    return (
      <button
        type="button"
        className={styles.listPersonalizationItem}
        onClick={onEdit}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={styles.personalizationCard}>
      <div className={clsx(styles.listPersonalizationItem, styles.listPersonalizationReadOnlyItem)}>
        {content}
      </div>
    </div>
  );
};

export default ExternalResourceDisplay;
