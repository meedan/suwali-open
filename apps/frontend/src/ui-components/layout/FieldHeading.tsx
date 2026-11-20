import clsx from 'clsx';

import styles from './FieldHeading.module.css';

type FieldHeadingProps = {
  // Lets a group of controls point at its heading as its label
  id?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  // Marks the label with the asterisk the inputs show in the same state, when what the heading stands for has a problem
  invalid?: boolean;
};

// The label, and an explanation when it needs one, above a field made of several controls, such as a group of cards
// TODO: other places could use this in place of their own plain <h3> above a group of RadioCards:
// ContributionAudienceSettings, ContributionReviewProcessSettings, RSSFeedWizardArticleContent and WizardTypeSelect
// in pages/data-sources. Along with it, a FieldGroup could wrap the <fieldset aria-labelledby> (or radiogroup) and its
// heading, as the languages and scenarios groups and the tone options in pages/personalization each do by hand.
// Not done yet since moving those would change how they look.
const FieldHeading = ({ id, label, description, invalid }: FieldHeadingProps) => (
  <>
    <div id={id} className={clsx(styles.label, invalid && styles.invalid)}>{label}</div>
    {description && <p className={styles.description}>{description}</p>}
  </>
);

export default FieldHeading;
