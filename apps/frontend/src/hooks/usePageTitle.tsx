import { useEffect } from 'react';
import { useIntl } from 'react-intl';

import { APP_NAME } from '@constants/App';

import { isRTL } from '@components/LanguageProvider';

type TitleProps = {
  id: string;
  defaultMessage?: string;
  description?: string;
  values?: Record<string, string | number>;
};

const usePageTitle = (title: React.ReactElement<TitleProps>) => {
  const intl = useIntl();

  useEffect(() => {
    const { id, defaultMessage, values, children } = title.props as TitleProps & { children?: string };
    const translated = id ? intl.formatMessage({ id, defaultMessage }, values) : (children ?? '');

   const pageTitle = isRTL(intl.locale)
      ? `${APP_NAME} | ${translated}`
      : `${translated} | ${APP_NAME}`;

    document.title = pageTitle;
  }, [title, intl]);
};

export default usePageTitle;
