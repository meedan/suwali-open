import { FormattedMessage } from 'react-intl';

import styles from './PasswordStrength.module.css';

type PasswordStrengthProps = {
  strength?: number;
};

const PasswordStrength = ({
  strength,
}: PasswordStrengthProps) => {
  return (
    <div className={styles.passwordStrength}>
      <ul data-strength={strength}>
        <li>25%</li>
        <li>50%</li>
        <li>75%</li>
        <li>100%</li>
      </ul>
      <FormattedMessage
        id="global.passwordStrengthinstructions"
        defaultMessage="Use 8 or more characters with a mix of letters, numbers, and symbols."
        description="Instructions to the user for the requirements of the password they are creating"
        tagName="p"
      />
    </div>
  );
};

export default PasswordStrength;
