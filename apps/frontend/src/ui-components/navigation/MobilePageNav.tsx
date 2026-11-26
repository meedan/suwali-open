import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import Button from '@ui-components/input/Button';
import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';
import Icon from '@ui-components/layout/Icon';
import { Modal } from '@ui-components/layout/Modal';
import MainPagesNav from '@ui-components/navigation/MainPagesNav';

import Me from '@components/Me';

import styles from "./MobilePageNav.module.css";

const messages = defineMessages({
  mainMenu: {
    id: 'global.mainMenu',
    defaultMessage: 'Main menu',
    description: 'Reusable label for the menu that lists the app’s main pages',
  },
});

type MobilePageNavProps = {
  currentValue?: string;
  left?: string | React.ReactNode;
  main?: string | React.ReactNode;
  right?: string | React.ReactNode;
  onChange?: (newValue: string) => void;
};

const MobilePageNav = ({
  currentValue,
  left,
  main,
  right,
  onChange
}: MobilePageNavProps) => {
  const intl = useIntl();

  return (
    <footer className={styles.mobilePageNav}>
      <Modal
        className={styles.mobileMainPageNav}
        size="large"
        title={
          <FormattedMessage
            id="global.mainMenu"
            defaultMessage="Main menu"
            description="Reusable label for the menu that lists the app’s main pages"
          />
        }
        hideTitle
        trigger={
          <Button
            aria-label={intl.formatMessage(messages.mainMenu)}
            iconLeft={<Icon id="list" aria-hidden />}
            size="medium"
            themeMode
          />
        }
        body={<MainPagesNav />}
      >
      </Modal>
      <nav>
        <ToggleGroup
          defaultValue="mobile-main"
          type="single"
          size="small"
          onValueChange={onChange}
          value={currentValue}
        >
          { left &&
            <ToggleGroupItem value="mobile-left">
              {left}
            </ToggleGroupItem>
          }
          { main &&
            <ToggleGroupItem value="mobile-main">
              {main}
            </ToggleGroupItem>
          }
          { right &&
            <ToggleGroupItem value="mobile-right">
              {right}
            </ToggleGroupItem>
          }
        </ToggleGroup>
      </nav>
      <Me avatarOnly />
    </footer>
  );
}

export default MobilePageNav;
