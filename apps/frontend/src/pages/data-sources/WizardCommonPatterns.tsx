import { FormattedMessage } from "react-intl";

import styles from './Wizard.module.css';

type WizardCommonPatternsProps = {
  patterns: {
    pattern: string;
    description: React.ReactNode;
  }[];
};

const WizardCommonPatterns = ({ patterns }: WizardCommonPatternsProps) => {
  return (
    <div className={styles.wizardPatterns} tabIndex={-1}>
      <FormattedMessage
        id="global.commonPatterns"
        defaultMessage="Common patterns"
        description="Label for common CSS selector patterns for article content"
        tagName="strong"
      />
      {patterns.map((item) => (
        <div key={item.pattern} className={styles.row}>
          <span className={styles.highlight}>{item.pattern}</span>
          {" - "}
          {item.description}
        </div>
      ))}
    </div>
  );
};

export default WizardCommonPatterns;
