import { defineMessages } from "react-intl";

export const messages = defineMessages({
  websiteUrlPlaceholder: {
    id: "websiteWizard.websiteUrlPlaceholder",
    defaultMessage: "Example:  https://www.myblog.com/articles",
    description: "Placeholder text for the website URL input field",
  },
  notListed: {
    id: "websiteWizardPaginationCard.notListed",
    defaultMessage: "Parameter not listed? Let us know what it is.",
    description: "Help text under the field for a page number parameter that was not detected, which also names its option",
  },
});

export const templateToSampleUrl = (templateUrl: string) => templateUrl.replace('{page}', '2');

export const getUrlParams = (url: string | undefined) => {
  try {
    const urlObj = new URL(url || '');
    return Object.fromEntries(urlObj.searchParams.entries());
  } catch {
    return {};
  }
};

export const getPathSegments = (url: URL) => {
  return url.pathname.split('/').filter(segment => segment.length > 0);
};

export const getSlashParams = (url: string | undefined) => {
  const slashParams: Record<string, string> = {};
  if (!url) return slashParams;

  try {
    const pathSegments = getPathSegments(new URL(url));

    pathSegments.forEach((segment, index) => {
      if (/^\d+$/.test(segment)) {
        slashParams[pathSegments[index-1]] = segment;
      }
    });

    return slashParams;
  } catch {
    return slashParams;
  }
};

export const getMostLikelyPaginationParam = (params: Record<string, string>) => {
  const commonParams = ['page', 'p', 'pg', 'pagina', 'paged', 'start'];

  // return the first matching common param
  for (const param of commonParams) {
    if (params[param]) {
      return param;
    }
  }

  return null;
};

export const getFirstNumericParam = (params: Record<string, string>) => {
  for (const [key, value] of Object.entries(params)) {
    if (/^\d+$/.test(value)) {
      return key;
    }
  }
  return null;
};

export const getMostLikelyPaginationType = (params: Record<string, string>, slashParams: Record<string, string>) => {
  const queryParam = getMostLikelyPaginationParam(params);
  if (queryParam) {
    return 'query';
  }
  const pathParam = getMostLikelyPaginationParam(slashParams);
  if (pathParam) {
    return 'path';
  }

  const firstNumericQueryParam = getFirstNumericParam(params);
  if (firstNumericQueryParam) {
    return 'query';
  }
  const firstNumericPathParam = getFirstNumericParam(slashParams);
  if (firstNumericPathParam) {
    return 'path';
  }

  // return whatever has more params
  if (Object.keys(params).length >= Object.keys(slashParams).length && Object.keys(params).length > 0) {
    return 'query';
  }
  if (Object.keys(slashParams).length > 0) {
    return 'path';
  }

  return null;
};
