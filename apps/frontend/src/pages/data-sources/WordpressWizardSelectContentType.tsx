import { FormattedMessage } from "react-intl";

import RadioCard from "@ui-components/layout/RadioCard";

import styles from "./Wizard.module.css";
import WizardStepFooter from "./WizardFooter";
import type { WordpressWizardStepProps } from "./WordpressWizard";

const WordpressWizardSelectContentType =({
  isEditing,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
}: WordpressWizardStepProps) => {
  return (
    <>
      <hgroup>
        <FormattedMessage
          id="wordpressWizard.selectContentType"
          defaultMessage="Select content type"
          description="Title for the content type selection step in the WordPress wizard"
          tagName="h3"
        />
      </hgroup>
      <div className={styles.wizardCardBody}>
        <FormattedMessage
          id="wordpressWizard.selectContentTypeSubtitle"
          defaultMessage="Choose the type of content you want to import from your WordPress site."
          description="Subtitle for the content type selection step in the WordPress wizard"
          tagName="p"
        />
        <RadioCard
          name="contentType"
          description={
            <FormattedMessage
              id="wordpressWizard.postsDescription"
              defaultMessage="Posts are individual pieces of time-based content on a site. Think of them as blog posts, articles, or updates that you share to offer new content to your readers. This is most likely the content you want available to your chatbot."
              description="A description of the Wordpress content type Post"
            />
          }
          title={
            <FormattedMessage
              id="wordpressWizard.postsRecommended"
              defaultMessage="Posts <strong>(Recommended)</strong>"
              description="Refers to the Wordpress content type Post and that is the recommended choice"
              values={{
                strong: msg => <strong key="strong">{msg}</strong>,
              }}
            />
          }
          value="posts"
          selected={wizardState.contentType === "posts"}
          size="large"
          onChange={() => setWizardState({ ...wizardState, contentType: "posts" })}
        />
        <RadioCard
          name="contentType"
          description={
            <FormattedMessage
              id="wordpressWizard.pagesDescription"
              defaultMessage="A website uses pages to display content — Home, About, and Contact are common examples. Pages are static — they’re not associated with a date or time. They are permanent fixtures of your site for people to access at any time."
              description="A description of the Wordpress content type Page"
            />
          }
          title={
            <FormattedMessage
              id="wordpressWizard.pages"
              defaultMessage="Pages"
              description="Refers to the Wordpress content type Page"
            />
          }
          value="pages"
          selected={wizardState.contentType === "pages"}
          size="large"
          onChange={() => setWizardState({ ...wizardState, contentType: "pages" })}
        />
      </div>
      <WizardStepFooter
        disableNext={!wizardState.siteUrl}
        isEditing={isEditing}
        onCancel={onCancel}
        onGoBack={() => onStepChange(currentStep - 1)}
        onGoNext={() => onStepChange(currentStep + 1)}
      />
    </>
  );
};

export default WordpressWizardSelectContentType;
