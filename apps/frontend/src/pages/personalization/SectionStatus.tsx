import { FormattedMessage } from 'react-intl';

import Icon from '@ui-components/layout/Icon';

import type { PersonalizationSection } from './personalizationSections';
import styles from './SectionStatus.module.css';
import { usePersonalizationHub } from './usePersonalizationHub';

type SectionStatusProps = {
  section: PersonalizationSection;
};

// Where a section stands: an attribute is set or not, and resources are counted, since there can be any number
const SectionStatus = ({ section }: SectionStatusProps) => {
  const { hub, resources } = usePersonalizationHub();

  if (section.id === 'externalResource') {
    const count = (
      resources.length > 0 ?
        <FormattedMessage
          id="global.personalizationResourcesCount"
          defaultMessage="{count, plural, one {# resource} other {# resources}}"
          description="Status of the external resources personalization: how many have been added. Example: 2 resources"
          values={{ count: resources.length }}
        />
      :
        <FormattedMessage
          id="global.personalizationStatusNotSet"
          defaultMessage="Not set up yet"
          description="Status of a personalization attribute that has not been set"
        />
    );

    const hasResources = resources.length > 0;

    return (
      <span className={hasResources ? styles.added : styles.pending}>
        <Icon aria-hidden id={hasResources ? 'check_circle_filled' : 'triangle_dashed'} />
        {count}
      </span>
    );
  }

  if (section.isConfigured?.(hub)) {
    return (
      <span className={styles.added}>
        <Icon aria-hidden id="check_circle_filled" />
        <FormattedMessage
          id="global.personalizationStatusAdded"
          defaultMessage="Added"
          description="Status of a personalization attribute that has been set"
        />
      </span>
    );
  }

  return (
    <span className={styles.pending}>
      <Icon aria-hidden id="triangle_dashed" />
      <FormattedMessage
        id="global.personalizationStatusNotSet"
        defaultMessage="Not set up yet"
        description="Status of a personalization attribute that has not been set"
      />
    </span>
  );
};

export default SectionStatus;
