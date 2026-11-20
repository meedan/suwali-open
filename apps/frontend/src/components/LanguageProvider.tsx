/* eslint-disable react-refresh/only-export-components */
// Context provider + hook pattern: keeping these together is standard for React context patterns and won't break Fast Refresh
import { Direction } from 'radix-ui';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { IntlProvider } from 'react-intl';

const LOCALE_STORAGE_KEY = 'suwali-locale';

const supportedLocales = ['en', 'ar', 'es', 'fr', 'hi', 'pt'];

const messageLoaders: Record<string, () => Promise<Record<string, string>>> = {
  ar: () => import('@lang/ar.json').then(m => m.default),
  es: () => import('@lang/es.json').then(m => m.default),
  fr: () => import('@lang/fr.json').then(m => m.default),
  hi: () => import('@lang/hi.json').then(m => m.default),
  pt: () => import('@lang/pt.json').then(m => m.default),
};

const defaultLocale = 'en';

const I18nContext = createContext<{ locale: string; setLocale: (l: string) => void }>({
  locale: defaultLocale,
  setLocale: () => {},
});

type I18nProviderProps = {
  children: React.ReactNode;
};

export const getStoredLocale = () => {
  return localStorage.getItem(LOCALE_STORAGE_KEY) || defaultLocale;
};

export const isRTL = (locale: string) => locale === 'ar';

export const I18nProvider = ({ children }: I18nProviderProps) => {
  const getInitialLocale = () => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && supportedLocales.includes(stored)) return stored;

    const browser =
      navigator.languages?.find(l => supportedLocales.includes(l.split('-')[0]))?.split('-')[0] ||
      navigator.language?.split('-')[0];

    const initialLocale = supportedLocales.includes(browser) ? browser : defaultLocale;
    localStorage.setItem(LOCALE_STORAGE_KEY, initialLocale);
    return initialLocale;
  };

  const [locale, setLocale] = useState(getInitialLocale);
  const [messages, setMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadMessages(locale: string) {
      if (locale === defaultLocale) {
        if (!cancelled) {
          setMessages({});
        }
        return;
      }

      const msgs = await messageLoaders[locale]();

      if (!cancelled) {
        setMessages(msgs);
      }
    }

    loadMessages(locale);

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const direction = isRTL(locale) ? 'rtl' : 'ltr';

  document.documentElement.lang = locale;
  document.documentElement.dir = direction;

  const handleChangeLocale = (l: string) => {
    setLocale(l);
    localStorage.setItem(LOCALE_STORAGE_KEY, l);
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale: handleChangeLocale }}>
      <Direction.Provider dir={direction}>
        <IntlProvider locale={locale} messages={messages} defaultLocale={defaultLocale}>
          {children}
        </IntlProvider>
      </Direction.Provider>
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
