import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';

import { useCan } from '@hooks/useCapabilities';

import Button from '@ui-components/input/Button';
import HintBox from '@ui-components/layout/HintBox';
import Icon from '@ui-components/layout/Icon';

import styles from './Personalization.module.css';
import { scenarioLabels, scenarios } from './scenarioLabels';
import { usePersonalizationHub } from './usePersonalizationHub';

type ExternalResourcesFooterProps = {
  onAdd: () => void;
  // Whether to offer adding a resource on its own when there is no note about the scenarios without one
  alwaysOfferAdd?: boolean;
};

// Closes the overview and the list of resources, for those who can manage them: a note naming the scenarios in
// which the chatbot has no resource to offer, which carries the way to add one, or else just that way to add one
// where it is always wanted. There is no note until there is a resource, since the setup checklist asks for the first.
const ExternalResourcesFooter = ({ onAdd, alwaysOfferAdd = false }: ExternalResourcesFooterProps) => {
  const { resources } = usePersonalizationHub();
  const canManage = useCan('MANAGE_EXTERNAL_RESOURCE').allowed;

  const uncovered = resources.length === 0 ? [] : scenarios.filter(scenario => !resources.some(resource => resource.scenarios.includes(scenario)));
  const hasUncoveredScenarios = uncovered.length > 0;

  if (!canManage || (!hasUncoveredScenarios && !alwaysOfferAdd)) return null;

  const addButton = (
    <Button
      iconLeft={<Icon id="plus" aria-hidden />}
      label={
        <FormattedMessage
          id="global.addResource"
          defaultMessage="Add resource"
          description="Button label to add a new resource for the chatbot to use"
        />
      }
      size="small"
      variant="filled"
      onClick={onAdd}
    />
  );

  return (
    <div
      className={clsx(
        styles.buttonWrapper,
        styles.listFooter,
        {
          [styles.resourcesFooter]: hasUncoveredScenarios,
          [styles.listFooterEmpty]: resources.length === 0
        })
      }
    >
      {hasUncoveredScenarios
        ? (
          <HintBox
            className={styles.coverageNote}
            type="warning"
            title={
              <FormattedMessage
                id="global.uncoveredScenariosTitle"
                defaultMessage="{count, plural, one {No resource is offered in this scenario:} other {No resource is offered in these scenarios:}}"
                description="Note listing the scenarios in which the chatbot has no resource to offer to the audience"
                tagName="span"
                values={{ count: uncovered.length }}
              />
            }
            body={
              <ul>
                {uncovered.map(scenario => <li key={scenario}><FormattedMessage {...scenarioLabels[scenario]} /></li>)}
              </ul>
            }
            actions={<div className={styles.noteActions}>{addButton}</div>}
          />
        )
        : addButton
      }
    </div>
  );
};

export default ExternalResourcesFooter;
