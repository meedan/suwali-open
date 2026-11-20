import { useState } from "react";
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import TextInput from "@ui-components/input/TextInput";
import HintBox from "@ui-components/layout/HintBox";

import type { WebsiteWizardStepProps } from "./WebsiteWizard";
import WebsiteWizardPaginationCard from "./WebsiteWizardPaginationCard";
import styles from "./Wizard.module.css";
import WizardCommonPatterns from "./WizardCommonPatterns";
import WizardStepFooter from "./WizardFooter";

const messages = defineMessages({
  articleLinkSelectorPlaceholder: {
    id: 'global.articleLinkSelectorPlaceholder',
    defaultMessage: 'Examples: a.post-link, article h2 a, .entry-title a',
    description: 'Placeholder for an article link input with text showing that the code shown are examples'
  },
  articleTitleSelectorPlaceholder: {
    id: 'global.articleTitleSelectorPlaceholder',
    defaultMessage: 'Examples: h1, .post-title',
    description: 'Placeholder for a title input with text showing that the code shown are examples'
  },
  articleBodyCssSelectorPlaceholder: {
    id: 'global.articleBodyCssSelectorPlaceholder',
    defaultMessage: 'Examples: .article-content, article .content, .post-content',
    description: 'Placeholder for an article body input with text showing that the code shown are examples'
  },
});

const WebsiteWizardArticleContent = ({
  isEditing,
  onCancel,
  onStepChange,
  currentStep,
  wizardState,
  setWizardState,
}: WebsiteWizardStepProps) => {
  const intl = useIntl();
  const [focusInput, setFocusInput] = useState<string>('');

  return (
    <>
      <hgroup>
        <FormattedMessage
          id="websiteWizard.configureWebsite"
          defaultMessage="Configure website"
          description="Title for the configuration step in the website wizard"
          tagName="h3"
        />
        <FormattedMessage
          id="websiteWizard.configureWebsiteDescription"
          defaultMessage="Configure pagination and CSS selectors so we are able to move across listings pages and ingest individual articles."
          description="Description for the configuration step in the website wizard"
          tagName="span"
        />
      </hgroup>
      {(wizardState.platform || wizardState.linksCssSelector || wizardState.titleCssSelector || wizardState.bodyCssSelector) && (
        <HintBox
          type="info"
          className={styles.descriptionHelpWrapper}
          body={
            <>
              {wizardState.platform && (
                <><FormattedMessage
                  id="websiteWizard.configureSelectorURLDetectionPlatform"
                  defaultMessage="The URL you provided seems to be built on <strong>{platform}</strong>."
                  description="First sentence of the tip shown when the configure endpoint identified the platform"
                  values={{
                    platform: wizardState.platform,
                    strong: msg => (<strong key="strong">{msg}</strong>),
                  }}
                  tagName="span"
                />{' '}</>
              )}
              <FormattedMessage
                id="websiteWizard.configureSelectorURLDetectionPartial"
                defaultMessage="We have pre-filled some selectors that might be right for you — update them if needed."
                description="Tip shown when the configure endpoint pre-filled some selectors"
                tagName="span"
              />
            </>
          }
        />
      )}
      <div className={styles.wizardCardBody}>
        <hgroup>
          <FormattedMessage
            id="websiteWizard.configurePagination"
            defaultMessage="Configure pagination"
            description="Title for the pagination configuration step in the website wizard"
            tagName="h3"
          />
          <FormattedMessage
            id="websiteWizard.configurePaginationDescription"
            defaultMessage="Configure pagination for the main listings page, and limit page ingestion."
            description="Description for the pagination configuration step in the website wizard"
            tagName="span"
          />
        </hgroup>
        <div className={styles.wizardReviewItem}>
          <WebsiteWizardPaginationCard wizardState={wizardState} setWizardState={setWizardState} />
        </div>
        <hgroup>
          <FormattedMessage
            id="websiteWizard.configureSelectors"
            defaultMessage="Configure selectors"
            description="Title for the CSS selector configuration step in the website wizard"
            tagName="h3"
          />
          <FormattedMessage
            id="websiteWizard.configureSelectorsDescription"
            defaultMessage="Configure CSS selectors for the main listings page article links, and for the individual article page title, and body."
            description="Description for the CSS selector configuration step in the website wizard"
            tagName="span"
          />
        </hgroup>
        <FormattedMessage
          id="websiteWizard.configureSelectorsListingSubHeader"
          defaultMessage="List of articles"
          description="Sub-header for the listing selector configuration step in the website wizard"
          tagName="h3"
        />
        <div
          className={styles.wizardReviewItem}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusInput(''); }}
        >
          <TextInput
            label={
              <FormattedMessage
                id="websiteWizard.articleLinkSelector"
                defaultMessage="CSS selector for article links"
                description="Label for the custom article content field input in the website wizard"
              />
            }
            value={wizardState.linksCssSelector || ''}
            onChange={(e) => setWizardState({ ...wizardState, linksCssSelector: e.target.value })}
            placeholder={intl.formatMessage(messages.articleLinkSelectorPlaceholder)}
            helpContent={
              <FormattedMessage
                id="websiteWizard.articleLinkHelpText"
                defaultMessage="This selector will find links to individual articles on your list page. Look at your article list — the clickable titles are usually inside specific HTML elements."
                description="Help text for the article links field input in the website wizard"
              />
            }
            onFocus={() => setFocusInput('article_link')}
            required
            size="large"
          />
          { focusInput === 'article_link' && (
            <WizardCommonPatterns
              patterns={[
                {
                  pattern: 'a.post-link',
                  description: (
                    <FormattedMessage
                      id="websiteWizard.postLinkClass"
                      defaultMessage="Links with a class of “post-link”"
                      description="Description for the a.post-link CSS selector pattern"
                    />
                  ),
                },
                {
                  pattern: 'article a',
                  description: (
                    <FormattedMessage
                      id="websiteWizard.articleLinkElement"
                      defaultMessage="Any link inside an article element"
                      description="Description for the article a CSS selector pattern"
                    />
                  ),
                },
                {
                  pattern: '.post-title a',
                  description: (
                    <FormattedMessage
                      id="websiteWizard.postTitleLinkClass"
                      defaultMessage="Links inside elements with a class of “post-title”"
                      description="Description for the .post-title a CSS selector pattern"
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
        <FormattedMessage
          id="websiteWizard.configureSelectorsArticleSubHeader"
          defaultMessage="Article page"
          description="Sub-header for the article selector configuration step in the website wizard"
          tagName="h3"
        />
        <div
          className={styles.wizardReviewItem}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusInput(''); }}
        >
          <TextInput
            label={
              <FormattedMessage
                id="websiteWizard.titleSelector"
                defaultMessage="CSS selector for article title"
                description="Label for the custom article content field input in the website wizard"
              />
            }
            value={wizardState.titleCssSelector || ''}
            onChange={(e) => setWizardState({ ...wizardState, titleCssSelector: e.target.value })}
            placeholder={intl.formatMessage(messages.articleTitleSelectorPlaceholder)}
            helpContent={
              <FormattedMessage
                id="websiteWizard.titleSelectorHelpText"
                defaultMessage="This selector will find the main headline of your article. Usually this is an h1 element."
                description="Help text for the custom article content field input in the website wizard"
              />
            }
            onFocus={() => setFocusInput('article_title')}
            required
            size="large"
          />
          { focusInput === 'article_title' && (
            <WizardCommonPatterns
              patterns={[
                {
                  pattern: 'h1',
                  description: (
                    <FormattedMessage
                      id="websiteWizard.h1Element"
                      defaultMessage="The main headline"
                      description="Description for the h1 CSS selector pattern"
                    />
                  )
                },
                {
                  pattern: '.post-title',
                  description: (
                    <FormattedMessage
                      id="websiteWizard.postTitleClass"
                      defaultMessage="Element with a class of “post-title”"
                      description="Description for the .post-title CSS selector pattern"
                    />
                  )
                },
                {
                  pattern: 'article h1',
                  description: (
                    <FormattedMessage
                      id="websiteWizard.articleH1Element"
                      defaultMessage="Headline inside an article element"
                      description="Description for the article h1 CSS selector pattern"
                    />
                  )
                },
              ]}
            />
          )}
          <TextInput
            label={
              <FormattedMessage
                id="global.articleBodyCssSelector"
                defaultMessage="CSS selector for article body"
                description="Label for the custom article content field input in the data sources wizard"
              />
            }
            value={wizardState.bodyCssSelector || ''}
            onChange={(e) => setWizardState({ ...wizardState, bodyCssSelector: e.target.value })}
            placeholder={intl.formatMessage(messages.articleBodyCssSelectorPlaceholder)}
            helpContent={
              <FormattedMessage
                id="global.articleBodyCssSelectorHelpText"
                defaultMessage="This selector will find the main content area containing the article text. We will extract all text from this element."
                description="Help text for the custom article content field input in the data sources wizard"
              />
            }
            onFocus={() => setFocusInput('article_body')}
            required
            size="large"
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
      </div>
      <WizardStepFooter
        disableNext={
          !wizardState.linksCssSelector ||
          !wizardState.titleCssSelector ||
          !wizardState.bodyCssSelector ||
          (wizardState.multiPage && !wizardState.templateUrl)
        }
        isEditing={isEditing}
        onCancel={onCancel}
        onGoBack={() => onStepChange(currentStep - 1)}
        onGoNext={() => onStepChange(currentStep + 1)}
      />
    </>
  );
};

export default WebsiteWizardArticleContent;
