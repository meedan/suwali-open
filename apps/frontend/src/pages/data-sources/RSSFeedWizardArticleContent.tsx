import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import TextInput from "@ui-components/input/TextInput";
import RadioCard from "@ui-components/layout/RadioCard";

import type { RSSFeedWizardState, RSSFeedWizardStepProps } from "./RSSFeedWizard";
import styles from "./Wizard.module.css";
import WizardCommonPatterns from "./WizardCommonPatterns";
import WizardStepFooter from "./WizardFooter";

const messages = defineMessages({
  articleBodyCssSelectorPlaceholder: {
    id: 'global.articleBodyCssSelectorPlaceholder',
    defaultMessage: 'Examples: .article-content, article .content, .post-content',
    description: 'Placeholder for an article body input with text showing that the code shown are examples'
  },
});

const RSSFeedWizardArticleContent = ({
  isEditing,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
}: RSSFeedWizardStepProps) => {
  const intl = useIntl();
  const [focusInput, setFocusInput] = useState<string>('');

  const handleContentSelect = (contentType: RSSFeedWizardState['contentType']) => {
    setWizardState({
      ...wizardState,
      contentType,
      // Clear out CSS selector if switching to description only
      cssSelector: contentType === 'description_only' ? undefined : wizardState.cssSelector,
    });
  };

  return (
    <>
      <hgroup>
        <FormattedMessage
          id="rssFeedWizard.selectArticleContent"
          defaultMessage="Select article content"
          description="Title for the article content selection step in the RSS Feed wizard"
          tagName="h3"
        />
        <FormattedMessage
          id="rssFeedWizard.enterFeedDetails"
          defaultMessage="Locate the main text for each article in your RSS feed"
          description="Description for the article content selection step in the RSS Feed wizard"
          tagName="span"
        />
      </hgroup>
      <div className={styles.wizardCardBody}>
        <RadioCard
          name="rss_article_content"
          title={
            <FormattedMessage
              id="rssFeedWizard.descriptionArticleContent"
              defaultMessage="Use the text in the RSS content and/or description fields"
              description="Title for the description only article content option in the RSS Feed wizard"
            />
          }
          description={
            <FormattedMessage
              id="rssFeedWizard.descriptionArticleContentDescription"
              defaultMessage="Your RSS feed appears to have the main article text available. Your chatbot will use this content to respond to your audience."
              description="Explanation under the option to use the text in the RSS feed content or description fields, shown when the feed includes the full article text"
            />
          }
          selected={wizardState.contentType === 'description_only'}
          onChange={() => handleContentSelect('description_only')}
        />
        <RadioCard
          name="rss_article_content"
          title={
            <FormattedMessage
              id="rssFeedWizard.fullArticleContent"
              defaultMessage="Use the article text from the RSS feed links"
              description="Title for the full article content option in the RSS Feed wizard"
            />
          }
          description={
            <FormattedMessage
              id="rssFeedWizard.fullArticleContentDescription"
              defaultMessage="The system will go to each link in your RSS feed and find the main text of your article, this may require you to provide some technical details helping us locate the content. Technical support or knowledge may be required."
              description="Description for the full article content option in the RSS Feed wizard"
            />
          }
          selected={wizardState.contentType === 'full_article'}
          onChange={() => handleContentSelect('full_article')}
        />
        { wizardState.contentType === 'full_article' && (
          <div onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusInput(''); }}>
            <TextInput
              helpContent={
                <FormattedMessage
                  id="global.articleBodyCssSelectorHelpText"
                  defaultMessage="This selector will find the main content area containing the article text. We will extract all text from this element."
                  description="Help text for the custom article content field input in the data sources wizard"
                />
              }
              label={
                <FormattedMessage
                  id="global.articleBodyCssSelector"
                  defaultMessage="CSS selector for article body"
                  description="Label for the custom article content field input in the data sources wizard"
                />
              }
              placeholder={intl.formatMessage(messages.articleBodyCssSelectorPlaceholder)}
              size="large"
              value={wizardState.cssSelector || ''}
              onChange={(e) => setWizardState({ ...wizardState, cssSelector: e.target.value })}
              onFocus={() => setFocusInput('article_body')}
            />
            { focusInput === 'article_body' && (
              <WizardCommonPatterns
                patterns={[
                  {
                    pattern: 'article',
                    description: (
                      <FormattedMessage
                        id="global.articleElement"
                        defaultMessage="The article element"
                        description="Description for the article CSS selector pattern"
                      />
                    ),
                  },
                  {
                    pattern: '.post-content',
                    description: (
                      <FormattedMessage
                        id="global.postContentClass"
                        defaultMessage="Element with a class of “post-content”"
                        description="Description for the .post-content CSS selector pattern"
                      />
                    ),
                  },
                  {
                    pattern: '.entry-content',
                    description: (
                      <FormattedMessage
                        id="global.entryContentClass"
                        defaultMessage="Common in WordPress themes"
                        description="Description for the .entry-content CSS selector pattern"
                      />
                    ),
                  },
                  {
                    pattern: 'main',
                    description: (
                      <FormattedMessage
                        id="global.mainElement"
                        defaultMessage="The main content area"
                        description="Description for the main CSS selector pattern"
                      />
                    ),
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>
      <WizardStepFooter
        disableNext={!wizardState.contentType || (wizardState.contentType === 'full_article' && !wizardState.cssSelector)}
        isEditing={isEditing}
        onCancel={onCancel}
        onGoBack={() => onStepChange(currentStep - 1)}
        onGoNext={() => onStepChange(currentStep + 1)}
      />
    </>
  );
};

export default RSSFeedWizardArticleContent;
