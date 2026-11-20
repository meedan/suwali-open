import clsx from "clsx";
import { FormattedMessage } from "react-intl";

import { SUPPORT_EMAIL } from '@constants/App';

import Icon from "@ui-components/layout/Icon";
import RadioCard from "@ui-components/layout/RadioCard";

import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";

const getWizardSteps = () => {
  return [
    {
      label: (
        <FormattedMessage
          id="global.dataSourceType"
          defaultMessage="Data source type"
          description="Label for the selection step of the type of a Data Source"
        />
      ),
      description: (
        <FormattedMessage
          id="global.selectDocumentSource"
          defaultMessage="Select the source of your documents"
          description="Label for the selection of the type of a Data Source"
        />
      ),
    },
    {
      label: '',
      description: '...'
    },
    {
      label: (
        <FormattedMessage
          id="global.reviewAndTest"
          defaultMessage="Review & test"
          description="Label for the review and testing configuration step"
        />
      ),
      description: (
        <FormattedMessage
          id="global.verifyConfiguration"
          defaultMessage="Verify configuration"
          description="Label for the review and testing configuration step"
        />
      ),
    },
  ];
};

type WizardTypeSelectProps = {
  type: string | null,
  isSetup?: boolean;
  onSelect: (type: string) => void;
  onStart: (run: boolean) => void;
};

const WizardTypeSelect = ({
  type,
  isSetup,
  onSelect,
  onStart,
}: WizardTypeSelectProps) => {
  const dataSourceTypes: { title: React.ReactNode, description: React.ReactNode, key: string, icon: string, featureFlag?: string }[] = [
    {
      title: (
        <FormattedMessage
          id="wizardTypeSelect.wordpress"
          defaultMessage="WordPress site <strong>(Recommended)</strong>"
          description="Label for the WordPress site data source type and that is a recommended path"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      description: (
        <FormattedMessage
          id="wizardTypeSelect.wordpressSetup"
          defaultMessage="Easy setup: <strong>2 steps,</strong> updates automatically"
          description="Description for the WordPress site setup process"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      key: 'wordpress_api',
      icon: 'wordpress_source',
    },
    {
      title: (
        <FormattedMessage
          id="wizardTypeSelect.rssFeed"
          defaultMessage="RSS feed <strong>(Recommended)</strong>"
          description="Label for the RSS Feed data source type including that its the recommended path"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      description: (
        <FormattedMessage
          id="wizardTypeSelect.easiestSetup"
          defaultMessage="Easiest setup: <strong>3 steps,</strong> updates automatically"
          description="Description for the easier setup process"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      key: 'rss_feed',
      icon: 'rss_source',
    },
    {
      title: (
        <FormattedMessage
          id="global.uploadedFiles"
          defaultMessage="Upload individual files <strong>(Fastest)</strong>"
          description="Label for the Uploaded Files data source type"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      description: (
        <FormattedMessage
          id="global.uploadedFilesSetup"
          defaultMessage="Fastest to get started: <strong>1 step</strong>"
          description="Description for the uploaded files setup process"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      key: 'uploaded_files',
      icon: 'upload_source',
    },
    {
      title: (
        <FormattedMessage
          id="wizardTypeSelect.googleDriveFolder"
          defaultMessage="Google Drive folder"
          description="Label for the Google Drive Folder data source type"
        />
      ),
      description: (
        <FormattedMessage
          id="wizardTypeSelect.easySetup"
          defaultMessage="Easy setup: <strong>2 steps,</strong> sync files from a folder"
          description="Description for the easier setup process"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      key: 'google_drive_folder',
      icon: 'google_drive',
    },
    {
      title: (
        <FormattedMessage
          id="wizardTypeSelect.website"
          defaultMessage="Blog/Website <strong>(Advanced)</strong>"
          description="Label for the website or blog data source type including that its an advanced choice"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      description: (
        <FormattedMessage
          id="wizardTypeSelect.advancedSetup"
          defaultMessage="Advanced: <strong>3 steps,</strong> requires technical support or knowledge"
          description="Description for the most technical setup process"
          values={{
            strong: msg => <strong key="strong">{msg}</strong>,
          }}
        />
      ),
      key: 'website',
      icon: 'website_source',
    },
  ];

  return (
    <div className={clsx(styles.wizardCard, {[styles.wizardSetupCard]: isSetup})}>
      {!isSetup && (
        <hgroup>
          <FormattedMessage
            id="wizardTypeSelect.title"
            defaultMessage="What is the source of the documents you would like to sync?"
            description="Title for the source type selection step in the Data Sources wizard"
            tagName="h3"
          />
        </hgroup>
      )}
      <div className={styles.wizardCardBody}>
        {dataSourceTypes.map(source => (
          <RadioCard
            key={source.key}
            name="data_source_type"
            title={source.title}
            icon={<Icon id={source.icon} />}
            selected={type === source.key}
            size="large"
            description={
              <div className={styles.stepCount}>
                <Icon id="arrow_right" />
                {source.description}
              </div>
            }
            onChange={() => {
              onSelect(source.key);
            }}
          />
        ))}
        {!isSetup &&
          <div className={styles.helpContainer}>
            <Icon id="question" />
            <FormattedMessage
              id="wizardTypeSelect.contactSupport"
              defaultMessage="Are your documents available from a different source? Let us know by contacting {helpLink}."
              description="Helper text that invites user to contact support if the data source type they need it not available"
              values={{
                helpLink: (
                  <a key="helpLink" href={`mailto:${SUPPORT_EMAIL}`} rel="noopener noreferrer" title={SUPPORT_EMAIL}>
                    <strong>{SUPPORT_EMAIL}</strong>
                  </a>
                ),
              }}
              tagName="span"
            />
          </div>
        }
      </div>
      <WizardStepFooter
        onGoNext={() => onStart(true)}
        disableNext={!type}
      />
    </div>
  );
};

WizardTypeSelect.getWizardSteps = getWizardSteps;

export default WizardTypeSelect;
