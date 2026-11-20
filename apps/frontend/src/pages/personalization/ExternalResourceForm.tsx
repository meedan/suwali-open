import type { CountryCode } from 'libphonenumber-js';
import { useEffect, useRef, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import type { ExternalResource, ResourceType, Scenario } from '@customTypes/external-resource';

import { guessCountry } from '@helpers/countries';
import { detectResourceType, getResourceIcon, normalizeResourceValue, splitPhone } from '@helpers/externalResource';

import { fetchAbout } from '@services/AboutService';
import { createExternalResource, deleteExternalResource, updateExternalResource } from '@services/ExternalResourcesService';

import TextArea from '@ui-components/input/TextArea';
import CharacterCount from '@ui-components/layout/CharacterCount';
import FieldHeading from '@ui-components/layout/FieldHeading';
import Icon from '@ui-components/layout/Icon';

import personalizationStyles from './Personalization.module.css';
import PersonalizationFormFooter from './PersonalizationFormFooter';
import { personalizationFormMessages } from './personalizationFormMessages';
import ResourceTypePicker from './ResourceTypePicker';
import ResourceValueField from './ResourceValueField';
import ScenarioPicker from './ScenarioPicker';

const messages = defineMessages({
  descriptionPlaceholder: {
    id: 'global.resourceDescriptionPlaceholder',
    defaultMessage: 'e.g., A short survey about our services, for end-users in New York. Your chatbot uses this to choose when to share the resource and how to introduce it.',
    description: 'Placeholder for the description field of an external resource, which the chatbot uses to decide when to share the resource and to introduce it in its messages',
  },
  addButton: {
    id: 'global.addNewResource',
    defaultMessage: 'Add new resource',
    description: 'Label for submit button',
  },
  saveButton: {
    id: 'global.saveResource',
    defaultMessage: 'Save resource',
    description: 'Label for save button in edit mode',
  },
  confirmDeleteTitle: {
    id: 'global.confirmDeleteExternalResourceTitle',
    defaultMessage: 'Remove external resource?',
    description: 'Title for confirmation dialog before removing an external resource',
  },
  confirmDeleteMessage: {
    id: 'global.confirmDeleteExternalResourceMessage',
    defaultMessage: 'Are you sure you want to <strong>remove</strong> this external resource?',
    description: 'Message for confirmation dialog before removing an external resource',
  },
  confirmDeleteInfo: {
    id: 'global.confirmDeleteExternalResourceInfo',
    defaultMessage: 'This resource will <strong>no longer</strong> be shown to end-users in the chatbot’s responses.',
    description: 'Info message for confirmation dialog before removing an external resource',
  },
  confirmDeleteButton: {
    id: 'global.confirmDeleteExternalResourceButton',
    defaultMessage: 'Remove resource',
    description: 'Button label for confirming deletion of external resource',
  },
});

type ExternalResourceFormProps = {
  hubId: number | string | null;
  resource?: ExternalResource;
  hasSavedValue?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
  onCancel?: () => void;
};

// What a saved resource is shown as when it is edited: the type it was saved with, or the one its title looks like.
// Free text is the one left for a title that looks like nothing else.
const savedTypeOf = (resource?: ExternalResource): ResourceType | '' => (
  resource ? resource.resource_type ?? detectResourceType(resource.title) ?? 'question' : ''
);

// A saved phone number is edited as the number typed in its country
const savedValueOf = (resource: ExternalResource | undefined, type: ResourceType | ''): { value: string; country: CountryCode } => {
  const phone = type === 'phone' && resource ? splitPhone(resource.title) : null;
  return phone ? { value: phone.national, country: phone.country } : { value: resource?.title || '', country: guessCountry() };
};

const ExternalResourceForm = ({
  hubId,
  resource,
  hasSavedValue = false,
  onSuccess,
  onError,
  onCancel,
}: ExternalResourceFormProps) => {
  const intl = useIntl();
  // The limits are not known until the server has said, so nothing is counted or limited here before then, and the server still validates them
  const { data: about } = useQuery({ queryKey: ['/about'], queryFn: fetchAbout });
  const maxQuestionLength = about?.max_resource_question_length;
  const maxDescriptionLength = about?.max_resource_description_length;

  const savedType = savedTypeOf(resource);
  const saved = savedValueOf(resource, savedType);

  const [type, setType] = useState<ResourceType | ''>(savedType);
  const [value, setValue] = useState(saved.value);
  const [country, setCountry] = useState<CountryCode>(saved.country);
  // The cursor goes to the field a type asks for when it was chosen with a pointer. With the keyboard the next tab goes there.
  const [focusValue, setFocusValue] = useState(false);
  const valueFieldsRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (focusValue) valueFieldsRef.current?.querySelector<HTMLElement>('#external-resource-value')?.focus();
  }, [type, focusValue]);
  const [description, setDescription] = useState(resource?.description || '');
  // An empty description is only called wrong once it has been left, or once what was typed has been cleared.
  // A saved resource from before descriptions were asked for is called wrong from the start.
  const [descriptionTouched, setDescriptionTouched] = useState(hasSavedValue && !resource?.description?.trim());
  const [scenarios, setScenarios] = useState<Scenario[]>(resource?.scenarios || []);
  const [scenariosTouched, setScenariosTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What is saved as the title, which is nothing while what was typed does not fit the type
  const title = type ? normalizeResourceValue(type, value, country, maxQuestionLength) : null;

  // A saved description that is longer than is allowed now has to be shortened to be saved again
  const isDescriptionValid = description.trim().length > 0 && (maxDescriptionLength === undefined || description.length <= maxDescriptionLength);

  // Nothing says why saving is not possible when everything else is filled in, so the scenarios say so. They are also
  // called wrong when the last one is cleared.
  const showScenarioError = scenarios.length === 0 && (scenariosTouched || (Boolean(title) && isDescriptionValid));

  const handleSubmit = async () => {
    if (!type || !title || !isDescriptionValid || scenarios.length === 0) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    if (hasSavedValue && resource) {
      try {
        await updateExternalResource({
          resourceId: resource.id,
          params: {
            resource_type: type,
            title,
            description: description.trim(),
            scenarios,
          }
        });
        onSuccess?.();
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        }
        onError?.();
      } finally {
        setIsSubmitting(false);
      }
    } else {
      try {
        await createExternalResource({
          params: {
            hub_id: Number(hubId),
            resource_type: type,
            title,
            description: description.trim(),
            scenarios,
          }
        });
        onSuccess?.();
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        }
        onError?.();
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const savedDescription = resource?.description || '';
  const savedScenarios = resource?.scenarios || [];

  const isDirty = value !== saved.value
    || country !== saved.country
    || description !== savedDescription
    || scenarios.length !== savedScenarios.length
    || scenarios.some(scenario => !savedScenarios.includes(scenario));

  // Editing a saved resource, cancelling means going back to what was saved
  const handleCancel = () => {
    setError(null);
    if (hasSavedValue) {
      setValue(saved.value);
      setCountry(saved.country);
      setDescription(savedDescription);
      setScenarios(savedScenarios);
    } else {
      setType('');
      setValue('');
      setDescription('');
      setScenarios([]);
      onCancel?.();
    }
  };

  const handleDelete = async () => {
    if (!resource) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await deleteExternalResource({
        resourceId: resource.id,
      });
      onSuccess?.();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
      onError?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
      <div className={personalizationStyles.personalizationFormWrapper}>
        {/* A saved resource keeps its type, which the field below is named for */}
        {!hasSavedValue && (
          <ResourceTypePicker
            value={type}
            onChange={(next, viaPointer) => {
              // What was typed was for another type of resource
              setType(next);
              setValue('');
              setFocusValue(viaPointer);
            }}
          />
        )}

        {type && (
          <fieldset ref={valueFieldsRef}>
            <ResourceValueField
              key={type}
              type={type}
              value={value}
              onChange={setValue}
              country={country}
              onCountryChange={setCountry}
              maxQuestionLength={maxQuestionLength}
              error={error}
            />

            <TextArea
              id="external-resource-description"
              label={
                <FormattedMessage
                  id="global.resourceDescriptionLabel"
                  defaultMessage="What does this resource offer?"
                  description="Label for the description field of an external resource"
                />
              }
              placeholder={intl.formatMessage(messages.descriptionPlaceholder)}
              helpContent={
                <>
                  <FormattedMessage
                    id="global.resourceDescriptionHint"
                    defaultMessage="Describe the resource instead of giving your chatbot instructions. For example, write “Applies to end-users in New York” instead of “Offer this to end-users in New York”."
                    description="Help under the description field of an external resource; descriptions written as commands to the chatbot are rejected as unsafe, so people should describe the resource instead"
                  />
                  {maxDescriptionLength !== undefined && (
                    <>
                      <br />
                      <span><CharacterCount count={description.length} max={maxDescriptionLength} /></span>
                    </>
                  )}
                </>
              }
              maxLength={maxDescriptionLength}
              value={description}
              onChange={(e) => {
                if (e.target.value.trim() === '') setDescriptionTouched(true);
                setDescription(e.target.value);
              }}
              onBlur={() => setDescriptionTouched(true)}
              error={descriptionTouched && description.trim() === '' ? <FormattedMessage {...personalizationFormMessages.resourceDescriptionRequired} /> : null}
              size="large"
              required
              rows={3}
            />
          </fieldset>
        )}

        {type && (
          <fieldset aria-labelledby="scenarios-label" className={personalizationStyles.fieldGroup}>
            <FieldHeading
              id="scenarios-label"
              invalid={showScenarioError}
              label={
                <FormattedMessage
                  id="global.scenariosLabel"
                  defaultMessage="In what scenarios should this resource be available?"
                  description="Label for scenarios section"
                />
              }
            />
            <ScenarioPicker
              selected={scenarios}
              onChange={(next) => {
                setScenariosTouched(true);
                setScenarios(next);
              }}
              error={showScenarioError ? <FormattedMessage {...personalizationFormMessages.resourceScenarioRequired} /> : null}
            />
          </fieldset>
        )}

        <PersonalizationFormFooter
          saveLabel={intl.formatMessage(hasSavedValue ? messages.saveButton : messages.addButton)}
          canSave={Boolean(title) && isDescriptionValid && scenarios.length > 0 && (!hasSavedValue || isDirty)}
          isSubmitting={isSubmitting}
          onSave={handleSubmit}
          secondaryAction={hasSavedValue ? 'discard' : 'cancel'}
          showSecondary={!hasSavedValue || isDirty}
          onSecondary={handleCancel}
          remove={hasSavedValue ? {
            title: intl.formatMessage(messages.confirmDeleteTitle),
            titleContext: <><Icon id={getResourceIcon({ resource_type: resource?.resource_type, title: resource?.title ?? '' })} aria-hidden /><strong>{resource?.title}</strong></>,
            body: (
            <>
              <FormattedMessage
                {...messages.confirmDeleteMessage}
                tagName="p"
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
              />
              <FormattedMessage
                {...messages.confirmDeleteInfo}
                tagName="p"
                values={{
                  strong: msg => <strong key="strong">{msg}</strong>,
                }}
              />
            </>
            ),
            confirmLabel: intl.formatMessage(messages.confirmDeleteButton),
            onConfirm: handleDelete,
          } : undefined}
        />
      </div>
  );
};

export default ExternalResourceForm;
