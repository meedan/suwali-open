import { useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import type { Scenario } from '@customTypes/external-resource';

import { fetchAbout } from '@services/AboutService';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import { scenarioGroups } from './scenarioLabels';
import ScenarioOption from './ScenarioOption';
import styles from './ScenarioPicker.module.css';

// Every scenario, in the order the groups present them
const orderedScenarios = scenarioGroups.flatMap(({ scenarios }) => scenarios);

// A group of one has nothing to shortcut to, its scenario is already one click away
const shortcutGroups = scenarioGroups.filter(({ scenarios }) => scenarios.length > 1);

type ScenarioPickerProps = {
  selected: Scenario[];
  onChange: (scenarios: Scenario[]) => void;
  // What is wrong with the selection, shown under the list
  error?: React.ReactNode;
};

// The scenarios to choose from, with shortcuts to choose a group of them and a way to read what each one means.
// A shortcut is on only while exactly its scenarios are selected. They only change what is selected, a group is not saved with the resource.
const ScenarioPicker = ({ selected, onChange, error }: ScenarioPickerProps) => {
  const [described, setDescribed] = useState<Scenario[]>([]);
  const [previewed, setPreviewed] = useState<Scenario[]>([]);
  const { data: about } = useQuery({ queryKey: ['/about'], queryFn: fetchAbout });

  const allDescribed = orderedScenarios.every(scenario => described.includes(scenario));

  const handleChange = (scenario: Scenario, checked: boolean) => {
    onChange(checked ? [...selected, scenario] : selected.filter(s => s !== scenario));
  };

  const handleToggleDescription = (scenario: Scenario) => {
    setDescribed(described.includes(scenario) ? described.filter(s => s !== scenario) : [...described, scenario]);
  };

  return (
    <>
      <div className={styles.scenarioPickerHeader}>
        <div className={styles.scenarioShortcuts}>
          <FormattedMessage
            id="global.scenarioShortcutsLabel"
            defaultMessage="Quick select:"
            description="Label before the buttons that select every external resource scenario of a kind at once"
            tagName="strong"
          />
          {shortcutGroups.map(({ id, label, scenarios }) => {
            const isOn = selected.length === scenarios.length && scenarios.every(scenario => selected.includes(scenario));

            return (
              <Button
                key={id}
                aria-pressed={isOn}
                themeMode={!isOn}
                label={<FormattedMessage {...label} />}
                size="small"
                type="button"
                // Which rows it would choose are lit while it is pointed at or focused
                onBlur={() => setPreviewed([])}
                onClick={() => onChange(isOn ? [] : scenarios)}
                onFocus={() => setPreviewed(scenarios)}
                onMouseEnter={() => setPreviewed(scenarios)}
                onMouseLeave={() => setPreviewed([])}
              />
            );
          })}
        </div>
        <Button
          iconLeft={<Icon id={allDescribed ? 'info_filled' : 'info'} aria-hidden />}
          label={allDescribed
            ? <FormattedMessage id="global.scenarioHideDescriptions" defaultMessage="Hide descriptions" description="Button that hides what every external resource scenario means" />
            : <FormattedMessage id="global.scenarioShowDescriptions" defaultMessage="Show descriptions" description="Button that shows what every external resource scenario means" />
          }
          themeMode
          size="small"
          variant="text"
          onClick={() => setDescribed(allDescribed ? [] : orderedScenarios)}
        />
      </div>
      {orderedScenarios.map(scenario => (
        <ScenarioOption
          key={scenario}
          scenario={scenario}
          checked={selected.includes(scenario)}
          previewed={previewed.includes(scenario)}
          showDescription={described.includes(scenario)}
          minutes={about?.conversation_inactivity_timeout_minutes}
          onChange={handleChange}
          onToggleDescription={handleToggleDescription}
        />
      ))}
      {error && (
        <div className="base-input-wrapper">
          <output className="base-error-container">
            <Icon id="error" aria-hidden />
            <span>{error}</span>
          </output>
        </div>
      )}
    </>
  );
};

export default ScenarioPicker;
