import { lazy, Suspense } from 'react';
import { FormattedMessage } from 'react-intl';

import { DEFAULT_TONE } from '@helpers/tone';

import { useCan } from '@hooks/useCapabilities';

import EmptyState from '@ui-components/layout/EmptyState';

import BotAttributeDisplay from './BotAttributeDisplay';
import BotAttributeForm, { type BotAttributeType } from './BotAttributeForm';
import styles from './Personalization.module.css';
import type { PersonalizationSection } from './personalizationSections';
import { usePersonalizationHub } from './usePersonalizationHub';
import { usePersonalizationSaved } from './usePersonalizationSaved';

const AvailableLanguagesForm = lazy(() => import('./AvailableLanguagesForm'));

type PersonalizationAttributeProps = {
  section: PersonalizationSection;
  // Where to go when someone backs out of setting the attribute for the first time
  onCancelAdd: () => void;
};

// One setting of the chatbot. Those who can edit always get the form (empty until it is set); everyone
// else sees the value, or a note when there is none.
const PersonalizationAttribute = ({ section, onCancelAdd }: PersonalizationAttributeProps) => {
  const { hub } = usePersonalizationHub();
  const canEdit = useCan(section.action).allowed;
  const { onSaved, onSaveError } = usePersonalizationSaved();

  const attributes = hub?.bot_attributes;
  const isConfigured = Boolean(section.isConfigured?.(hub));
  const hasValue = Boolean((section.hasValue ?? section.isConfigured)?.(hub));

  const formProps = {
    hubId: hub?.id || null,
    currentBotAttributes: attributes || {},
    onSuccess: onSaved,
    onError: onSaveError,
  };

  if (canEdit) {
    // Remounts when the value is set or removed, so the form starts from what was saved. Settings with a default
    // count as set up before then, so it is the value that tells.
    const formKey = `${section.id}-${hasValue}`;

    if (section.id === 'availableLanguages') {
      return (
        <Suspense>
          <AvailableLanguagesForm key={formKey} hasSavedValue={isConfigured} {...formProps} onCancel={onCancelAdd} />
        </Suspense>
      );
    }

    return <BotAttributeForm key={formKey} attributeType={section.id as BotAttributeType} hasSavedValue={isConfigured} {...formProps} onCancel={onCancelAdd} />;
  }

  if (!isConfigured) return <NoPermission />;

  switch (section.id) {
    case 'chatbotName':
      return <BotAttributeDisplay type="name" value={attributes!.name!} />;
    case 'roleDescription':
      return <BotAttributeDisplay type="description" value={attributes!.description!} />;
    case 'responseStyle':
      return <BotAttributeDisplay type="tone" value={attributes?.tone ?? DEFAULT_TONE} />;
    default:
      return (
        <BotAttributeDisplay
          type="languages"
          languages={attributes?.supported_languages ?? []}
          defaultLanguage={attributes?.default_language}
        />
      );
  }
};

export const NoPermission = () => (
  <EmptyState
    className={styles.personalizationCard}
    icon="triangle_dashed"
    message={
      <FormattedMessage
        id="global.personalizationNoPermission"
        defaultMessage="An administrator on your team can manage personalization settings."
        description="Message displayed on Personalization panel when user does not have permission"
      />
    }
    size="small"
  />
);

export default PersonalizationAttribute;
