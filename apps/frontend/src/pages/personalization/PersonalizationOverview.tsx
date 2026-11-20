import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';

import Icon from '@ui-components/layout/Icon';

import ExternalResourcesFooter from './ExternalResourcesFooter';
import personalizationStyles from './Personalization.module.css';
import styles from './PersonalizationOverview.module.css';
import type { PersonalizationSection } from './personalizationSections';
import { availablePersonalizationSections, personalizationGroupMessages } from './personalizationSections';
import SectionStatus from './SectionStatus';
import { usePersonalizationHub } from './usePersonalizationHub';
import { usePersonalizationProgress } from './usePersonalizationProgress';

type PersonalizationOverviewProps = {
  onSelect: (slug: string) => void;
  onAddResource: () => void;
};

const GROUPS: PersonalizationSection['group'][] = ['identity', 'behavior', 'resources'];

// Every setting at a glance, and the way to each one. Resources count as set up once there is one.
const PersonalizationOverview = ({ onSelect, onAddResource }: PersonalizationOverviewProps) => {
  const { hub } = usePersonalizationHub();
  const sections = availablePersonalizationSections(hub);
  const { setUp, total } = usePersonalizationProgress();

  return (
    <div className={personalizationStyles.personalizationCard}>
      <FormattedMessage
        id="global.personalizationProgress"
        defaultMessage="{setUp, number} of {total, plural, one {# personalization} other {# personalizations}} set up"
        description="Progress through setting up the chatbot’s personalization. Example: 3 of 4 settings set up"
        tagName="h2"
        values={{ setUp, total }}
      />
      {GROUPS.map(group => {
        const groupSections = sections.filter(section => section.group === group);

        if (groupSections.length === 0) return null;

        return (
          <section key={group} className={styles.group}>
            <h3 className={styles.groupHeading}><FormattedMessage {...personalizationGroupMessages[group]} /></h3>
            <ul className={personalizationStyles.itemList}>
              {groupSections.map(section => (
                <li key={section.id}>
                  <button type="button" className={personalizationStyles.listPersonalizationItem} onClick={() => onSelect(section.slug)}>
                    <div className={personalizationStyles.personalizationIconWrapper}>
                      <Icon aria-hidden id={section.icon} />
                    </div>
                    <div className={personalizationStyles.listPersonalizationContentWrapper}>
                      <FormattedMessage {...(section.pluralLabel ?? section.label)} tagName="h4" />
                    </div>
                    <span className={styles.status}><SectionStatus section={section} /></span>
                    <Icon aria-hidden className={clsx('icon-flip-rtl', styles.chevron)} id="chevron_right" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {sections.some(({ id }) => id === 'externalResource') && <ExternalResourcesFooter onAdd={onAddResource} />}
    </div>
  );
};

export default PersonalizationOverview;
