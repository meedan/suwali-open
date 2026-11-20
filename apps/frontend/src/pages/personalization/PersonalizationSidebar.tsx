import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { getResourceIcon } from '@helpers/externalResource';

import { useCan } from '@hooks/useCapabilities';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import ListHeader from '@ui-components/layout/ListHeader';
import ListItem from '@ui-components/layout/ListItem';
import { ListSkeleton } from '@ui-components/layout/LoadingIndicator';
import Tooltip from '@ui-components/layout/Tooltip';

import type { PersonalizationSection } from './personalizationSections';
import { availablePersonalizationSections, personalizationGroupMessages } from './personalizationSections';
import SectionStatus from './SectionStatus';
import { usePersonalizationHub } from './usePersonalizationHub';
import { usePersonalizationProgress } from './usePersonalizationProgress';

const messages = defineMessages({
  addResource: {
    id: 'global.addResource',
    defaultMessage: 'Add resource',
    description: 'Button label to add a new resource for the chatbot to use',
  },
});

const GROUPS: PersonalizationSection['group'][] = ['identity', 'behavior', 'resources'];

type PersonalizationSidebarProps = {
  // The slug of the section being shown, or nothing for the overview
  activeSlug?: string;
  // The resource being shown, by id, or 'new' while one is being added
  activeResourceId?: string;
  onSelect: (slug?: string) => void;
  onSelectResource: (resourceId: number | 'new') => void;
};

const PersonalizationSidebar = ({ activeSlug, activeResourceId, onSelect, onSelectResource }: PersonalizationSidebarProps) => {
  const intl = useIntl();
  const { hub, resources, resourcesPending } = usePersonalizationHub();
  const canManageResources = useCan('MANAGE_EXTERNAL_RESOURCE').allowed;
  const { setUp, total } = usePersonalizationProgress();
  const sections = availablePersonalizationSections(hub);

  return (
    <>
    <div className="layout-left-column-scrollable-area">
      <ListItem
        caption={
          <FormattedMessage
            id="global.personalizationProgressShort"
            defaultMessage="{setUp, number} of {total, number} set up"
            description="Progress through setting up the chatbot’s personalization, under the overview in the sidebar. Example: 3 of 5 set up"
            values={{ setUp, total }}
          />
        }
        icon={<Icon aria-hidden id="personalization_source" />}
        isActive={!activeSlug && !activeResourceId}
        title={
          <FormattedMessage
            id="global.overview"
            defaultMessage="Overview"
            description="Title for the overview section"
          />
        }
        onClick={() => onSelect()}
      />
      {GROUPS.map(group => {
        const groupSections = sections.filter(section => section.group === group);

        if (groupSections.length === 0) return null;

        // Resources are listed one by one, since each has its own page, with a way to add another
        if (group === 'resources') {
          return (
            <div key={group}>
              <ListHeader
                actionRight={canManageResources &&
                  <Tooltip content={
                    <FormattedMessage
                      id="global.addResource"
                      defaultMessage="Add resource"
                      description="Button label to add a new resource for the chatbot to use"
                    />
                  }>
                    <Button
                      aria-label={intl.formatMessage(messages.addResource)}
                      iconLeft={<Icon aria-hidden id="plus" />}
                      size="small"
                      themeMode
                      variant="filled"
                      onClick={() => onSelectResource('new')}
                    />
                  </Tooltip>
                }
                sticky
                title={
                  <Button
                    label={
                      // Little hack, ListHeader has a count prop but passing a Button as title breaks the layout
                      resourcesPending ?
                      <FormattedMessage
                        id="global.resources"
                        defaultMessage="Resources"
                        description="Generic header or label for resources available to the chatbot"
                      /> :
                      <FormattedMessage
                        id="global.resourcesCount"
                        defaultMessage="Resources ({count})"
                        description="Generic header or label for resources available to the chatbot with count"
                        values={{ count: resources.length }}
                      />
                    }
                    size="small"
                    themeMode
                    variant="text"
                    onClick={() => onSelect(groupSections[0].slug)}
                  />
                }
              />
              {resourcesPending && <ListSkeleton count={3} skipHeader />}
              {!resourcesPending && resources.map(resource => (
                <ListItem
                  key={resource.id}
                  caption={
                    <FormattedMessage
                      id="global.personalizationResourceScenarios"
                      defaultMessage="{count, plural, =0 {Not used in any scenario} one {Used in # scenario} other {Used in # scenarios}}"
                      description="Under a resource in the personalization sidebar, how many chatbot scenarios use it. Example: Used in 2 scenarios"
                      values={{ count: resource.scenarios.length }}
                    />
                  }
                  icon={<Icon aria-hidden id={getResourceIcon(resource)} />}
                  isActive={activeResourceId === String(resource.id)}
                  title={resource.title}
                  onClick={() => onSelectResource(resource.id)}
                />
              ))}
            </div>
          );
        }

        return (
          <div key={group}>
            <ListHeader sticky title={<FormattedMessage {...personalizationGroupMessages[group]} />} />
            {groupSections.map(section => (
              <ListItem
                key={section.id}
                caption={<SectionStatus section={section} />}
                icon={<Icon aria-hidden id={section.icon} />}
                isActive={activeSlug === section.slug}
                title={<FormattedMessage {...section.label} />}
                onClick={() => onSelect(section.slug)}
              />
            ))}
          </div>
        );
      })}
    </div>
    {canManageResources &&
      <footer>
        <Button
          iconLeft={<Icon aria-hidden id="plus" />}
          label={
            <FormattedMessage
              id="global.addResource"
              defaultMessage="Add resource"
              description="Button label to add a new resource for the chatbot to use"
            />
          }
          orientation="vertical"
          size="small"
          themeMode
          variant="menu"
          onClick={() => onSelectResource('new')}
        />
      </footer>
    }
    </>
  );
};

export default PersonalizationSidebar;
