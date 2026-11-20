import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import styles from './JumpToTopOfListButton.module.css';

type JumpToTopOfListButtonProps = {
  onClick: () => void;
};

const JumpToTopOfListButton = ({ onClick }: JumpToTopOfListButtonProps) => (
  <div className={styles.dock}>
    <Button
      className={styles.button}
      iconLeft={<Icon id="arrow_up" aria-hidden />}
      label={
        <FormattedMessage
          id="global.jumpToTop"
          defaultMessage="Jump to top"
          description="Reusable label for a button that leaves the selected item and shows a list from its first item"
        />
      }
      size="small"
      themeMode
      onClick={onClick}
    />
  </div>
);

export default JumpToTopOfListButton;
