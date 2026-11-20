import clsx from 'clsx';
import { useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { Navigate, useNavigate, useParams } from 'react-router';

import { getResourceIcon } from '@helpers/externalResource';

import { useHubPath } from '@hooks/useHubPath';
import usePageTitle from '@hooks/usePageTitle';

import Icon from '@ui-components/layout/Icon';
import { Layout } from '@ui-components/layout/Layout';

import EditableTitle from '@components/EditableTitle';

import ExternalResourceMeta from './ExternalResourceMeta';
import styles from './Personalization.module.css';
import PersonalizationAttribute from './PersonalizationAttribute';
import PersonalizationOverview from './PersonalizationOverview';
import PersonalizationPreview from './PersonalizationPreview';
import PersonalizationResource from './PersonalizationResource';
import PersonalizationResources from './PersonalizationResources';
import { availablePersonalizationSections } from './personalizationSections';
import PersonalizationSidebar from './PersonalizationSidebar';
import { usePersonalizationHub } from './usePersonalizationHub';

const PersonalizationMain = () => {
  const { section: slug, resourceId: resourceParam } = useParams();
  const navigate = useNavigate();
  const hubPath = useHubPath();
  const { hub, resources } = usePersonalizationHub();
  const [mobileTab, setMobileTab] = useState('mobile-main');

  const sections = availablePersonalizationSections(hub);
  const resourcesSection = sections.find(({ id }) => id === 'externalResource');
  const resourceId = resourceParam === 'new' ? 'new' : (/^\d+$/.test(resourceParam ?? '') ? Number(resourceParam) : undefined);
  const resource = typeof resourceId === 'number' ? resources.find(({ id }) => id === resourceId) : undefined;
  const section = slug ? sections.find(({ slug: s }) => s === slug) : undefined;
  const tabSection = section ?? (resourceParam ? resourcesSection : undefined);

  // The tab is titled by the area being shown, and a resource, or a new one, is just the resources area, as its value would be confusing there
  usePageTitle(
    tabSection ? (
      <FormattedMessage {...(tabSection.pluralLabel ?? tabSection.label)} />
    ) : (
      <FormattedMessage
        id="global.personalizations"
        defaultMessage="Personalizations"
        description="Title for personalization/bot identity settings"
      />
    )
  );

  // A section that does not exist, or that this hub does not have, goes back to the overview
  if (slug && hub && !section) return <Navigate replace to={hubPath('/personalization')} />;

  // A resource that is not a number, or whose section this hub does not have, goes back to where it can be found
  if (resourceParam && hub && !resourcesSection) return <Navigate replace to={hubPath('/personalization')} />;
  if (resourceParam && hub && resourceId === undefined) return <Navigate replace to={hubPath('/personalization/resources')} />;

  const iconSection = section ?? (resourceId === 'new' ? resourcesSection : undefined);
  const titleIcon = iconSection ? iconSection.icon : resource ? getResourceIcon(resource) : 'bot_voice';

  const goToOverview = () => navigate(hubPath('/personalization'));
  const goToResources = () => navigate(hubPath('/personalization/resources'));

  const select = (selected?: string) => {
    setMobileTab('mobile-main');
    navigate(hubPath(selected ? `/personalization/${selected}` : '/personalization'));
  };

  const selectResource = (selected: number | 'new') => {
    setMobileTab('mobile-main');
    navigate(hubPath(`/personalization/resources/${selected}`));
  };

  return (
    <Layout mobileTab={mobileTab} onMobileTabChange={setMobileTab}>
      <Layout.Left
        name={
          <FormattedMessage
            id="global.personalizations"
            defaultMessage="Personalizations"
            description="Title for personalization/bot identity settings"
          />
        }
      >
        <div className="layout-left-column-content">
          <PersonalizationSidebar activeResourceId={resourceParam} activeSlug={section?.slug} onSelect={select} onSelectResource={selectResource} />
        </div>
      </Layout.Left>
      <Layout.Main
        name={
          <FormattedMessage
            id="global.details"
            defaultMessage="Details"
            description="Label for interaction when the user selects this item it will show the details of the associated area"
          />
        }
      >
        <div className={clsx('layout-main-column-scrollable-area', styles.personalizationWrapper)}>
          <EditableTitle
            className={styles.personalizationTitle}
            canEdit={false}
            displayValue={
              section ? (
                <FormattedMessage {...(section.pluralLabel ?? section.label)} />
              ) : resourceId === 'new' ? (
                <FormattedMessage
                  id="global.addResource"
                  defaultMessage="Add resource"
                  description="Button label to add a new resource for the chatbot to use"
                />
              ) : resource ? (
                resource.title
              ) : (
                <FormattedMessage
                  id="global.personalizationPanelDescription"
                  defaultMessage="Attributes and resources your chatbot will consider when responding to the audience."
                  description="Description for the personalization panel"
                />
              )
            }
            icon={<Icon aria-hidden className="no-mobile-access" id={titleIcon} />}
            renderMeta={resource && <ExternalResourceMeta resource={resource} /> }
          />
          <div className={styles.personalization}>
            {resourceId !== undefined ? (
              <PersonalizationResource key={resourceId} resourceId={resourceId} onDone={goToResources} />
            ) : section ? (
              <>
                {section.id === 'externalResource'
                  ? <PersonalizationResources onAdd={() => selectResource('new')} onOpen={selectResource} />
                  : <PersonalizationAttribute key={section.id} section={section} onCancelAdd={goToOverview} />
                }
              </>
            ) : (
              <PersonalizationOverview onAddResource={() => selectResource('new')} onSelect={select} />
            )}
            <PersonalizationPreview
              hubId={hub?.id || 0}
              defaultLanguage={hub?.bot_attributes?.default_language}
              hubLanguages={hub?.bot_attributes?.supported_languages}
            />
          </div>
        </div>
      </Layout.Main>
    </Layout>
  );
};

export default PersonalizationMain;
