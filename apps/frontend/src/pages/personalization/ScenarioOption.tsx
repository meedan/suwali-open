import clsx from 'clsx';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import type { Scenario } from '@customTypes/external-resource';

import Button from '@ui-components/input/Button';
import CheckboxCard from '@ui-components/layout/CheckboxCard';
import Icon from '@ui-components/layout/Icon';

import { scenarioDescriptions, scenarioLabels } from './scenarioLabels';
import styles from './ScenarioOption.module.css';

const messages = defineMessages({
  moreInfo: {
    id: 'global.scenarioMoreInfo',
    defaultMessage: 'More information',
    description: 'Accessible label of the button that shows what an external resource scenario means. Read together with the name of the scenario it belongs to',
  },
});

type ScenarioOptionProps = {
  scenario: Scenario;
  checked: boolean;
  // A quick select that would choose it is being pointed at
  previewed: boolean;
  showDescription: boolean;
  // How long a conversation waits for the user before it closes, once known
  minutes?: number;
  onChange: (scenario: Scenario, checked: boolean) => void;
  onToggleDescription: (scenario: Scenario) => void;
};

// One scenario to choose, with what it means shown when asked for rather than always taking up room
const ScenarioOption = ({ scenario, checked, previewed, showDescription, minutes, onChange, onToggleDescription }: ScenarioOptionProps) => {
  const intl = useIntl();
  // The closing description counts the minutes, so it waits for them rather than show a broken message
  const descriptionShown = showDescription && (scenario !== 'conversation_closed' || minutes !== undefined);

  const descriptionId = `scenario-${scenario}-description`;
  const titleId = `scenario-${scenario}-title`;
  const infoId = `scenario-${scenario}-info`;

  return (
    <div className={styles.scenarioRow}>
      <CheckboxCard
        className={clsx(styles.scenarioCard, { [styles.scenarioCardPreviewed]: previewed })}
        description={descriptionShown && <span id={descriptionId}><FormattedMessage {...scenarioDescriptions[scenario]} values={{ minutes }} /></span>}
        id={`scenario-${scenario}`}
        selected={checked}
        size="large"
        title={<span id={titleId}><FormattedMessage {...scenarioLabels[scenario]} /></span>}
        value={scenario}
        onChange={() => onChange(scenario, !checked)}
      />
      <Button
        className={styles.scenarioInfo}
        aria-controls={descriptionShown ? descriptionId : undefined}
        aria-expanded={descriptionShown}
        // Named by the label then the scenario, read one after the other, so the scenario is never part of a translated sentence
        id={infoId}
        aria-label={intl.formatMessage(messages.moreInfo)}
        aria-labelledby={`${infoId} ${titleId}`}
        iconLeft={<Icon aria-hidden id={showDescription ? 'info_filled' : 'info'} />}
        themeMode={!showDescription}
        size="small"
        onClick={() => onToggleDescription(scenario)}
      />
    </div>
  );
};

export default ScenarioOption;
