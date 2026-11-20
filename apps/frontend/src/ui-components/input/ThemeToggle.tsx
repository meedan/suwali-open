import clsx from 'clsx';
import { defineMessages, FormattedMessage, type MessageDescriptor, useIntl } from 'react-intl';

import Icon from '@ui-components/layout/Icon';

import { type Theme, useTheme } from "@components/ThemeProvider";

import styles from "./ThemeToggle.module.css";
import { ToggleGroup, ToggleGroupItem } from './ToggleGroup';

const messages = defineMessages({
  theme: {
    id: 'themeToggle.theme',
    defaultMessage: 'Theme switcher',
    description: 'Accessibility label to indicate this is a theme switcher interface',
  },
  matchTitle: {
    id: 'themeToggle.matchTitle',
    defaultMessage: 'Match system',
    description: 'Label for toggling the UI theme to match the theme of the users computer',
  },
  lightTitle: {
    id: 'themeToggle.lightTitle',
    defaultMessage: 'Light',
    description: 'Label for toggling the UI theme to light mode',
  },
  darkTitle: {
    id: 'themeToggle.darkTitle',
    defaultMessage: 'Dark',
    description: 'Label for toggling the UI theme to dark mode',
  }
});

type ThemeOption = {
  value: Theme;
  icon: string;
  preview: string;
  label: MessageDescriptor;
  className: string;
};

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', icon: 'desktop', preview: 'theme_preview_dual', label: messages.matchTitle, className: styles.optionSystem },
  { value: 'light', icon: 'sun', preview: 'theme_preview_light', label: messages.lightTitle, className: styles.optionLight },
  { value: 'dark', icon: 'moon', preview: 'theme_preview_dark', label: messages.darkTitle, className: styles.optionDark },
];

type ThemeToggleProps = {
  className?: string;
  full?: boolean;
};

const ThemeToggle = ({
  className,
  full = false,
}: ThemeToggleProps) => {
  const intl = useIntl();

  const { theme, setTheme } = useTheme();

  const handleToggle = (newValue: Theme) => {
    if (newValue) {
      setTheme(newValue);
    }
  };

  return (
    <ToggleGroup
      size={full ? 'medium' : 'small'}
      className={clsx(styles.themeToggle, full && styles.fullMode, className)}
      type="single"
      aria-label={intl.formatMessage(messages.theme)}
      value={theme}
      onValueChange={handleToggle}
    >
      {THEME_OPTIONS.map(option => (
        <ToggleGroupItem
          key={option.value}
          className={clsx(styles.option, option.className)}
          iconLeft={<Icon id={option.icon} aria-hidden />}
          value={option.value}
          // Compact options show only an icon, so they need a name of their own; full ones show their label
          aria-label={full ? undefined : intl.formatMessage(option.label)}
        >
          {full &&
            <>
              <Icon id={option.preview} className={styles.preview} aria-hidden />
              <span className={styles.label}><FormattedMessage {...option.label} /></span>
            </>
          }
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default ThemeToggle;
