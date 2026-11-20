import clsx from "clsx";
import { useState } from "react";

import type { Source } from "@customTypes/source";

import WizardStepper from "@ui-components/layout/WizardStepper";

import GoogleDriveWizard from "./GoogleDriveWizard";
import RSSFeedWizard from "./RSSFeedWizard";
import UploadedFilesWizard from "./UploadedFilesWizard";
import WebsiteWizard from "./WebsiteWizard";
import styles from "./Wizard.module.css";
import WizardTypeSelect from "./WizardTypeSelect";
import WordpressWizard from "./WordpressWizard";

export type WizardProps = {
  source?: Source | null;
  isEditing?: boolean;
  isSetup?: boolean;
  readOnly?: boolean;
  onCancel: () => void;
  onCreate: (sourceId: number) => void;
  onStepChange: (step: number) => void;
  currentStep: number;
  onSwitchToWordpress?: (siteUrl: string) => void;
};

type WizardComponentAndSteps = React.ComponentType<WizardProps> & {
  getWizardSteps: () => { label: React.ReactNode, description: React.ReactNode }[];
  getWizardHeading: () => { icon: string, label: React.ReactNode };
};

const components: Record<string, WizardComponentAndSteps> = {
  rss_feed: RSSFeedWizard,
  uploaded_files: UploadedFilesWizard,
  google_drive_folder: GoogleDriveWizard,
  website: WebsiteWizard,
  wordpress_api: WordpressWizard,
};

type DataSourcesCreateWizardProps = {
  isSetup?: boolean;
  title?: string | React.ReactNode;
  onCreate: (sourceId: number) => void;
  onTypeChange?: (type: string | null) => void;
};

const DataSourcesCreateWizard = ({
  isSetup,
  title,
  onCreate,
  onTypeChange,
}: DataSourcesCreateWizardProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [type, setType] = useState<string | null>(null);
  const [runWizard, setRunWizard] = useState<boolean>(false);
  const [wordpressSiteUrl, setWordpressSiteUrl] = useState<string | undefined>();

  const changeType = (t: string | null) => {
    setType(t);
    onTypeChange?.(t);
  };

  const switchToWordpress = (siteUrl: string) => {
    setWordpressSiteUrl(siteUrl);
    changeType('wordpress_api');
    setCurrentStep(1);
  };

  const genericSteps = WizardTypeSelect.getWizardSteps();
  const typeSteps = type ? components[type!].getWizardSteps() : [];

  const heading = runWizard && type ? components[type].getWizardHeading() : undefined;

  const wizardSteps = type ? [genericSteps[0], ...typeSteps] : genericSteps;

  const wizardProps = {
    currentStep,
    isSetup,
    onCancel: () => {
      setRunWizard(false);
      changeType(null);
      setCurrentStep(0);
      setWordpressSiteUrl(undefined);
    },
    onCreate,
    onStepChange: setCurrentStep,
    onSwitchToWordpress: switchToWordpress,
  };

  return (
    <div
      className={clsx(
        [styles.wizardMainLayout],
        {
          [styles.wizardMainSetupLayout]: isSetup,
        })
      }
    >
      {!isSetup && <WizardStepper title={title} heading={heading} currentStep={runWizard ? currentStep + 1 : 0} steps={wizardSteps} /> }
      { !runWizard && (
        <WizardTypeSelect
          type={type}
          isSetup={isSetup}
          onSelect={changeType}
          onStart={(run) => setRunWizard(run)}
        />
      )}
      { runWizard && type === 'rss_feed' && <RSSFeedWizard  {...wizardProps} />}
      { runWizard && type === 'uploaded_files' && <UploadedFilesWizard  {...wizardProps} />}
      { runWizard && type === 'google_drive_folder' && <GoogleDriveWizard  {...wizardProps} />}
      { runWizard && type === 'website' && <WebsiteWizard  {...wizardProps} />}
      { runWizard && type === 'wordpress_api' && <WordpressWizard  {...wizardProps} initialSiteUrl={wordpressSiteUrl} />}
    </div>
  );
};

export default DataSourcesCreateWizard;
