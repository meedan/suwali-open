import { useCallback, useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { normalizeUrl } from "@helpers/forms";

import TextInput from "@ui-components/input/TextInput";
import UrlInput from "@ui-components/input/UrlInput";
import HintBox from "@ui-components/layout/HintBox";
import Icon from "@ui-components/layout/Icon";
import RadioCard from "@ui-components/layout/RadioCard";

import type { WebsiteWizardState } from "./WebsiteWizard";
import styles from './WebsiteWizardPaginationCard.module.css';
import {
  getFirstNumericParam,
  getMostLikelyPaginationParam,
  getMostLikelyPaginationType,
  getPathSegments,
  getSlashParams,
  getUrlParams,
  messages,
} from "./WebsiteWizardPaginationCardUtil";
import wizardStyles from './Wizard.module.css';

type WebsiteWizardPaginationCardProps = {
  wizardState: WebsiteWizardState;
  setWizardState: React.Dispatch<React.SetStateAction<WebsiteWizardState>>;
};

const WebsiteWizardPaginationCard = ({ wizardState, setWizardState}: WebsiteWizardPaginationCardProps) => {
  const intl = useIntl();
  const {
    multiPage,
    paginationStart,
    paginationEnd,
    templateUrl,
    websiteUrl,
    paginationSampleUrl,
  } = wizardState;

  const [selectedParam, setSelectedParam] = useState<string | null>(null);
  const [customParam, setCustomParam] = useState<string>('');
  const [selectCustomParam, setSelectCustomParam] = useState<boolean>(false);
  const [detectedPaginationType, setDetectedPaginationType] = useState<'query' | 'path' | null>(null);

  const updateWizardState = useCallback((updates: Partial<WebsiteWizardState>) => {
    setWizardState((prev: WebsiteWizardState) => ({ ...prev, ...updates }));
  }, [setWizardState]);

  const handleSelectQuery = useCallback((key: string, value: string) => {
    setSelectedParam(key);
    setSelectCustomParam(false);
    updateWizardState({
      templateUrl: paginationSampleUrl?.replace(`${key}=${value}`, `${key}={page}`),
    });
  }, [paginationSampleUrl, updateWizardState]);

  const handleChangeQuery = useCallback((customParam: string) => {
    setCustomParam(customParam);
    const urlObj = new URL(paginationSampleUrl || '');
    if (customParam.trim()) {
      urlObj.searchParams.set(customParam, 'page');
      updateWizardState({
        templateUrl: urlObj.toString().replace(`${customParam}=page`, `${customParam}={page}`),
      });
    } else {
      updateWizardState({ templateUrl: undefined });
    }
  }, [paginationSampleUrl, updateWizardState]);

  const handleSelectPath = useCallback((key: string, value: string) => {
    setSelectedParam(key);
    setSelectCustomParam(false);
    updateWizardState({
      templateUrl: paginationSampleUrl?.replace(`/${key}/${value}`, `/${key}/{page}`),
    });
  }, [paginationSampleUrl, updateWizardState]);

  const handleChangePath = useCallback((customParam: string) => {
    setCustomParam(customParam);
    if (customParam.trim()) {
      const pathSegments = getPathSegments(new URL(paginationSampleUrl || ''));
      pathSegments.push(customParam, 'page');
      const newUrl = new URL(paginationSampleUrl || '');
      newUrl.pathname = '/' + pathSegments.join('/');
      updateWizardState({
        templateUrl: newUrl.toString().replace(`/${customParam}/page`, `/${customParam}/{page}`),
      });
    } else {
      updateWizardState({ templateUrl: undefined });
    }
  }, [paginationSampleUrl, updateWizardState]);

  useEffect(() => {
    // Parse inside the effect
    const params = getUrlParams(paginationSampleUrl);
    const slashParams = getSlashParams(paginationSampleUrl);

    if (!multiPage) {
      setSelectedParam(null);
      setCustomParam('');
      setSelectCustomParam(false);
    } else {
      const paginationType = getMostLikelyPaginationType(params, slashParams);
      setDetectedPaginationType(paginationType || null);

      if (paginationType === 'query') {
        const likelyParam = getMostLikelyPaginationParam(params) || getFirstNumericParam(params) || Object.keys(params)[0];
        if (likelyParam) {
          handleSelectQuery(likelyParam, params[likelyParam]);
        }
      } else if (paginationType === 'path') {
        const likelyParam = getMostLikelyPaginationParam(slashParams) || getFirstNumericParam(slashParams) || Object.keys(slashParams)[0];
        if (likelyParam) {
          handleSelectPath(likelyParam, slashParams[likelyParam]);
        }
      }
    }
  }, [paginationSampleUrl, multiPage, handleSelectPath, handleSelectQuery]);

  const params = getUrlParams(paginationSampleUrl);
  const slashParams = getSlashParams(paginationSampleUrl);

  return (
    <>
      {websiteUrl && (
        <div className={styles.isMulti}>
          <FormattedMessage
            id="websiteWizardPaginationCard.doesSpanMultiplePages"
            defaultMessage="Does your article list span multiple pages?"
            description="Header for single/multi page selector"
            tagName="strong"
          />
          <RadioCard
            name="pagination_multi_page"
            selected={multiPage}
            title={
              <FormattedMessage
                id="websiteWizardPaginationCard.yesMultiple"
                defaultMessage="Yes, multiple pages (most common)"
                description="Website wizard paginated content option"
              />
            }
            description={
              <FormattedMessage
                id="websiteWizardPaginationCard.yesMultipleDescription"
                defaultMessage="Articles are spread across multiple pages"
                description="Description for website wizard paginated content option"
              />
            }
            onChange={() => {
              updateWizardState({ multiPage: true });
            }}
          />
          <RadioCard
            name="pagination_multi_page"
            selected={!multiPage}
            title={
              <FormattedMessage
                id="websiteWizardPaginationCard.noSinglePage"
                defaultMessage="No, single page"
                description="Description for website wizard non-paginated content option"
              />
            }
            description={
              <FormattedMessage
                id="websiteWizardPaginationCard.noSinglePageDescription"
                defaultMessage="All articles are on one page"
                description="Description for website wizard non-paginated content option"
              />
            }
            onChange={() => {
              // Reset local state if giving up pagination
              setSelectedParam(null);
              setCustomParam('');
              setSelectCustomParam(false);
              updateWizardState({ multiPage: false, templateUrl: undefined });
            }}
          />
        </div>
      )}
      {websiteUrl && multiPage && (
        <UrlInput
          id="pagination-sample-url"
          helpContent={
            <FormattedMessage
              id="websiteWizard.hintBox"
              defaultMessage="<strong>Tip:</strong> If your list spans multiple pages, paste a URL from page 2 (like <highlight>?page=2</highlight> or <highlight>/page/2</highlight>) so we can detect how pagination works."
              description="Hint for auto detecting pagination parameters in the website wizard"
              tagName="span"
              values={{
                strong: msg => <strong key="strong">{msg}</strong>,
                highlight: (text) => <span key="highlight" className={wizardStyles.highlight}>{text}</span>,
              }}
            />
          }
          label={
            <FormattedMessage
              id="websiteWizardPaginationCard.sampleUrlLabel"
              defaultMessage="URL of page 2"
              description="Label for the sample paginated URL input field in the website wizard"
            />
          }
          placeholder={`${intl.formatMessage(messages.websiteUrlPlaceholder)}?page=2`}
          size="large"
          value={paginationSampleUrl || ''}
          onChange={(value) => updateWizardState({ paginationSampleUrl: value || undefined })}
        />
      )}
      {websiteUrl && multiPage && paginationSampleUrl && normalizeUrl(paginationSampleUrl) && !detectedPaginationType && (
        <HintBox
          type="warning"
          title={
            <FormattedMessage
              id="global.updateUrl"
              defaultMessage="Please update the URL above"
              description="Prompts the user to update the input URL"
            />
          }
          body={
            <FormattedMessage
              id="websiteWizardPaginationCard.noParamsWarning"
              defaultMessage="Change the URL to be from page 2 so we can detect how pagination works."
              description="Warning shown when no query string parameters are detected in the website wizard pagination card"
              tagName="span"
            />
          }
        />
      )}
      { websiteUrl && multiPage && paginationSampleUrl && detectedPaginationType && (
        <div className={styles.paginationCard}>
          { detectedPaginationType === 'query' && (
            <div className={styles.titleRow}>
              <Icon aria-hidden id="check_circle_filled" />
              <FormattedMessage
                id="websiteWizardPaginationCard.queryStringDetected"
                defaultMessage="Detected query string pagination!"
                description="Informs that we have detected a pagination parameter in the url query string"
                tagName="strong"
              />
            </div>
          )}
          { detectedPaginationType === 'path' && (
            <div className={styles.titleRow}>
              <Icon aria-hidden id="check_circle_filled" />
              <FormattedMessage
                id="websiteWizardPaginationCard.slashPathDetected"
                defaultMessage="Detected path-based pagination!"
                description="Informs that we have detected a pagination parameter in the url slash path"
                tagName="strong"
              />
            </div>
          )}
          {templateUrl}
          <div className={styles.paramSelect}>
            <FormattedMessage
              id="websiteWizardPaginationCard.whichParameter"
              defaultMessage="Which parameter controls the page number?"
              description="Prompt for selecting the parameter that determines the page number in a website index"
              tagName="strong"
            />
            {detectedPaginationType === 'query' && Object.entries(params).map(([key, value]) => (
              <div key={key}>
                <RadioCard
                  ariaLabel={`?${key}=${value}`}
                  name="pagination_parameter"
                  selected={selectedParam === key}
                  onChange={() => handleSelectQuery(key, value)}
                >
                  <span className={wizardStyles.highlight}>{`?${key}=${value}`}</span>
                </RadioCard>
              </div>
            ))}
            {detectedPaginationType === 'path' && Object.entries(slashParams).map(([key, value]) => (
              <div key={key}>
                <RadioCard
                  ariaLabel={`/${key}/${value}`}
                  name="pagination_parameter"
                  selected={selectedParam === key}
                  onChange={() => handleSelectPath(key, value)}
                >
                  <span className={wizardStyles.highlight}>{`/${key}/${value}`}</span>
                </RadioCard>
              </div>
            ))}
            <RadioCard
              ariaLabel={intl.formatMessage(messages.notListed)}
              name="pagination_parameter"
              selected={selectCustomParam}
              onChange={() => {
                setSelectCustomParam(true);
                setSelectedParam(null);
                if (detectedPaginationType === 'query') {
                  handleChangeQuery(customParam);
                } else {
                  handleChangePath(customParam);
                }
              }}
            >
              <TextInput
                helpContent={<FormattedMessage {...messages.notListed} />}
                value={customParam}
                size="small"
                onChange={e => {
                  if (detectedPaginationType === 'query') {
                    handleChangeQuery(e.target.value);
                  } else {
                    handleChangePath(e.target.value);
                  }
                }}
              />
            </RadioCard>
          </div>
          <div className={styles.pageSelect}>
            <FormattedMessage
              id="websiteWizardPaginationCard.syncArticlePages"
              defaultMessage="Sync articles from page {startPage} to {endPage} (Max: 100 pages)"
              description="Option to sync articles from a range of pages of a website. {startPage} and {endPage} are number inputs for the first and last page to sync"
              values={{
                startPage: (
                  <TextInput
                    key="startPage"
                    value={paginationStart || 1}
                    type="number"
                    size="small"
                    onChange={(e) => updateWizardState({ paginationStart: Number(e.target.value) })}
                  />
                ),
                endPage: (
                  <TextInput
                    key="endPage"
                    value={paginationEnd || 100}
                    type="number"
                    size="small"
                    onChange={(e) => updateWizardState({ paginationEnd: Number(e.target.value) })}
                  />
                ),
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default WebsiteWizardPaginationCard;
