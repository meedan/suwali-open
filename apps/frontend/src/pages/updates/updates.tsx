import type { ReactNode } from 'react';
import type { IntlShape } from 'react-intl';
import { FormattedMessage } from 'react-intl';

import { ButtonLink } from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

type HubPath = (path: string) => string;
type UpdateField = ReactNode | ((hubPath: HubPath, intl: IntlShape) => ReactNode);

export type Update = {
  id: string;
  date: string;
  title: UpdateField;
  thumbNail?: UpdateField;
  content: UpdateField;
};

export const updates: Update[] = [
  {
    id: 'october-2026-wordpress',
    date: '2026-10-26',
    title: (
      <FormattedMessage
        id="updates.updateWordpress"
        defaultMessage="Connect your WordPress site to Suwali"
        description="Title for app update around connecting a WordPress site as a data source"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/app-update-wordpress.png"
        alt={intl.formatMessage({ id: 'updates.updateWordpress', defaultMessage: 'Connect your WordPress site to Suwali', description: 'Title for app update around connecting a WordPress site as a data source' })}
      />
    ),
    content: (hubPath) => (
      <>
        <FormattedMessage
          id="updates.updateWordpressDescription"
          defaultMessage="You can now add a <strong>WordPress site</strong> as a data source. Enter your site’s address, confirm that you manage it, and choose whether to import your posts or your pages."
          description="Description for app update around connecting a WordPress site as a data source"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="updates.updateWordpressDescriptionContinued"
          defaultMessage="Suwali reads your published content through the WordPress REST API and keeps it up to date as you publish new articles."
          description="Continued description for app update around connecting a WordPress site as a data source"
          tagName="p"
        />
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="global.newDataSource"
                defaultMessage="New data source"
                description="Generic label or title for adding a new source of documents"
              />
            }
            to={hubPath('/data-sources/new')}
          />
        </p>
      </>
    ),
  },
  {
    id: 'august-2026-allowlist',
    date: '2026-08-17',
    title: (
      <FormattedMessage
        id="updates.updateContributions"
        defaultMessage="Tips, reports, ideas, and knowledge from anyone in your audience"
        description="Title for app update around updates to the process of collecting community contributions"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/app-update-allowlist.png"
        alt={intl.formatMessage({ id: 'updates.updateContributions', defaultMessage: 'Tips, reports, ideas, and knowledge from anyone in your audience', description: 'Title for app update around updates to the process of collecting community contributions' })}
      />
    ),
    content: (hubPath) => (
      <>
        <FormattedMessage
          id="updates.updateContributionsDescription"
          defaultMessage="Go beyond the <strong>trusted end-user</strong> contributions workflow by allowing community contributions from anyone in your audience."
          description="Description for app update around updates to the community contributions workflow"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="updates.updateContributionsDescriptionContinued"
          defaultMessage="People can share news tips, local observations, or early warnings as soon as they notice them. Share your contribution code and start to learn from your audience."
          description="Continued description for app update around updates to the community contributions workflow"
          tagName="p"
        />
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="global.dataSourcesContributionsSettings"
                defaultMessage="Community contributions settings"
                description="Button label for adding a new source of documents"
              />
            }
            to={hubPath('/data-sources/contributions/settings')}
          />
        </p>
      </>
    ),
  },
  {
    id: 'august-2026-googledrive',
    date: '2026-08-15',
    title: (
      <FormattedMessage
        id="updates.updateGoogleDrive"
        defaultMessage="Connecting Suwali to your Google Drive — simplified"
        description="Title for app update around updates to the process of connecting Google Drive"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/app-update-google-drive.png"
        alt={intl.formatMessage({ id: 'updates.updateGoogleDrive', defaultMessage: 'Connecting Suwali to your Google Drive — simplified', description: 'Title for app update around updates to the process of connecting Google Drive' })}
      />
    ),
    content: (hubPath) => (
      <>
        <FormattedMessage
          id="updates.updateGoogleDriveDescription"
          defaultMessage="It’s now simpler to connect Suwali to a Google Drive folder and have it stay in sync. You authenticate with your Google Drive account and select the first batch of files to add to your Suwali folder."
          description="Description for app update around new personalization resources"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="updates.updateGoogleDriveDescriptionContinued"
          defaultMessage="After that, you can manage all the files you want in Suwali directly from Google Drive, just update your Suwali folder and the files will be kept in sync automatically."
          description="Continued description for app update around new personalization resources"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="global.newDataSource"
                defaultMessage="New data source"
                description="Generic label or title for adding a new source of documents"
              />
            }
            to={hubPath('/data-sources/new')}
          />
        </p>
      </>
    ),
  },
  {
    id: 'june-2026-newpersonalizations',
    date: '2026-06-15',
    title: (
      <FormattedMessage
        id="updates.newResources"
        defaultMessage="Speak with a person and product and services support"
        description="Title for app update around new personalization resources"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/speak-purchase.gif"
        style={{width: '350px', maxWidth: 'unset'}}
        alt={intl.formatMessage({ id: 'updates.newResources', defaultMessage: 'Speak with a person and product and services support', description: 'Title for app update around new personalization resources' })}
      />
    ),
    content: (hubPath) => (
      <>
        <FormattedMessage
          id="updates.newResourcesDescription"
          defaultMessage="Are there times when your audience needs to reach a representative from your organization? Do you have products or services that you want your audience to be aware of?"
          description="Description for app update around new personalization resources"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="updates.newResourcesDescriptionContinued"
          defaultMessage="When the system detects your audience needs to speak to a person, or they are interested in your products and services, you can add a link, email address, or phone number and it will be included in your chatbot’s response."
          description="Additional description for app update around new personalization resources"
          tagName="p"
        />
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="updates.setupPersonalizations"
                defaultMessage="Set up personalizations"
                description="link title for going to the personalizations area"
              />
            }
            to={hubPath('/personalization')}
          />
        </p>
      </>
    ),
  },
  {
    id: 'june-2026-contributions',
    date: '2026-06-08',
    title: (
      <FormattedMessage
        id="updates.contributionWorkflow"
        defaultMessage="Direct or paused? Customize your trusted end-user audience contributions"
        description="Title for app update around contributions workflow customization"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/app-update-contributions.png"
        alt={intl.formatMessage({ id: 'updates.contributionWorkflow', defaultMessage: 'Direct or paused? Customize your trusted end-user audience contributions', description: 'Title for app update around contributions workflow customization' })}
      />
    ),
    content: (hubPath) => (
      <>
        <FormattedMessage
          id="updates.contributionWorkflowDescription"
          defaultMessage="Your chatbot can take in contributions from trusted members of your audience. That new knowledge can now be added directly and used <strong>automatically</strong> by your chatbot to respond to other end-users. Or you can choose to have their contributions start off as <strong>paused</strong>."
          description="Description for app update around contributions workflow customization"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <FormattedMessage
          id="updates.contributionWorkflowDescriptionContinued"
          defaultMessage="With contributions starting off <strong>paused</strong>, it gives you the opportunity to review and approve, or have that content inform new documents you add to your data sources, you’re in control."
          description="Additional description for app update around contributions workflow customization"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="updates.setupContributionWorkflowSettings"
                defaultMessage="Customize contributions"
                description="link title for going to the contributions settings area"
              />
            }
            to={hubPath('/data-sources/contributions/settings')}
          />
        </p>
      </>
    ),
  },
  {
    id: 'june-2026-languages',
    date: '2026-06-01',
    title: (
      <FormattedMessage
        id="updates.languagePersonalization"
        defaultMessage="Select your supported languages"
        description="Title for app update around supported languages"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/app-update-languages.png"
        alt={intl.formatMessage({ id: 'updates.languagePersonalization', defaultMessage: 'Select your supported languages', description: 'Title for app update around supported languages' })}
      />
    ),
    content: (hubPath) => (
      <>
        <FormattedMessage
          id="updates.languagePersonalizationDescription"
          defaultMessage="Do you want your chatbot to only respond in select languages? Set the list of languages your chatbot will respond in by setting a new personalization."
          description="Description for app update around supported languages"
          tagName="p"
        />
        <FormattedMessage
          id="updates.languagePersonalizationAvailable"
          defaultMessage="Available languages: <strong>English, العربية, Español, Français, हिन्दी, Português</strong>"
          description="List of available languages that the system supports"
          tagName="p"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="updates.setupPersonalizations"
                defaultMessage="Set up personalizations"
                description="link title for going to the personalizations area"
              />
            }
            to={hubPath('/personalization')}
          />
        </p>
      </>
    ),
  },
  {
    id: 'may-2026-important',
    date: '2026-05-27',
    title: (
      <FormattedMessage
        id="updates.importantTitle"
        defaultMessage="Important documents"
        description="Title for marking data source items as important"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/app-update-important.png"
        alt={intl.formatMessage({ id: 'updates.importantTitle', defaultMessage: 'Important documents', description: 'Title for marking data source items as important' })}
      />
    ),
    content: (
      <FormattedMessage
        id="updates.importantDescription"
        defaultMessage="Your chatbot can give extra weight or importance to items and documents from your data sources. Look for the {icon} icon and mark them as important."
        description="Description for marking data source items as important"
        tagName="p"
        values={{
          icon: <Icon key="icon" id="important" aria-hidden />,
        }}
      />
    ),
  },
  {
    id: 'may-2026-welcome',
    date: '2026-05-27',
    title: (
      <FormattedMessage
        id="updates.welcomeTitle"
        defaultMessage="Welcome message resources"
        description="Title for the update around setting up a welcome message"
      />
    ),
    thumbNail: (_, intl) => (
      <img
        src="/assets/images/app-update-welcome.png"
        alt={intl.formatMessage({ id: 'updates.welcomeTitle', defaultMessage: 'Welcome message resources', description: 'Title for the update around setting up a welcome message' })}
      />
    ),
    content: (hubPath, intl) => (
      <>
        <FormattedMessage
          id="updates.welcomePersonalizationDescription"
          defaultMessage="You can now add a link, email address, or phone number to be included in the first message sent back to your audience. Use this resource to provide resources to your audience outside of your chatbot."
          description="Description for app update around welcome message resources"
          tagName="p"
        />
        <p>
          <a className="text-link" href="https://www.suwali.io/resources/#set-up-personalization" title={intl.formatMessage({ id: 'updates.settingUpPersonalizations', defaultMessage: 'Setting up personalizations', description: 'Tooltip on the learn more link in the welcome message update' })} target="_blank" rel="noopener noreferrer">
            <FormattedMessage
              id="updates.learnMorePersonalizations"
              defaultMessage="Learn more about personalizations"
              description="Link title for accessing personalization resources"
            />
          </a>
        </p>
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="updates.setupPersonalizations"
                defaultMessage="Set up personalizations"
                description="link title for going to the personalizations area"
              />
            }
            to={hubPath('/personalization')}
          />
        </p>
      </>
    ),
  },
  {
    id: 'may-2026-upload',
    date: '2026-05-19',
    title: (
      <FormattedMessage
        id="updates.uploadTitle"
        defaultMessage="Upload files"
        description="Title for the update concerning uploading files as a data source"
      />
    ),
    content: (hubPath) => (
      <>
        <FormattedMessage
          id="updates.uploadDescription"
          defaultMessage="Have a few documents you want your chatbot to use for responding to your audience? You can now include them by adding a new uploaded files data source. Supported files are the same as the Google Drive data source option, but with the flexibility of adding up to 5 files at a time."
          description="Description of uploaded files update."
          tagName="p"
        />
        <p>
          <ButtonLink
            themeMode
            size="small"
            label={
              <FormattedMessage
                id="updates.uploadTitle"
                defaultMessage="Upload files"
                description="Title for the update concerning uploading files as a data source"
              />
            }
            to={hubPath('/data-sources/new')}
          />
        </p>
      </>
    ),
  },
];
