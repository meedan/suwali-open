import { Children } from 'react';

import styles from './PreviewDetails.module.css';

type PreviewDetailsProps = {
  children: React.ReactNode;
};

// The details of an item beside its preview, in sections of fields
const PreviewDetails = ({ children }: PreviewDetailsProps) => (
  <div className={styles.previewDetails}>
    {children}
  </div>
);

type HeadingProps = {
  title: React.ReactNode;
  // What can be done to what the heading is for, beside the heading so the information can follow below
  action?: React.ReactNode;
};

// The heading of a section or of a field, which look the same
const Heading = ({ title, action }: HeadingProps) => (
  <div className={styles.header}>
    {title && <h3>{title}</h3>}
    {action}
  </div>
);

type SectionProps = {
  // A heading for the section, with an action that goes with it, such as to edit what it shows
  title?: React.ReactNode;
  action?: React.ReactNode;
  // While true, the section takes over the whole of the details, and the other sections are hidden until it is not
  editing?: boolean;
  children: React.ReactNode;
};

const Section = ({ title, action, editing, children }: SectionProps) => {
  // A section of things that are not there is not shown, nor the line between it and the next
  if (!title && Children.toArray(children).length === 0) return null;

  return (
    <section className={styles.section} data-editing={editing || undefined}>
      {(title || action) && <Heading title={title} action={action} />}
      {children}
    </section>
  );
};

type FieldProps = {
  label: React.ReactNode;
  // What can be done to the value, on the line of the value so it is clear what it changes
  action?: React.ReactNode;
  children: React.ReactNode;
};

const Field = ({ label, action, children }: FieldProps) => (
  <div className={styles.field}>
    <Heading title={label} />
    {action ? (
      <div className={styles.valueRow}>
        <div className={styles.value}>{children}</div>
        {action}
      </div>
    ) : (
      <div className={styles.value}>{children}</div>
    )}
  </div>
);

PreviewDetails.Section = Section;
PreviewDetails.Field = Field;

export default PreviewDetails;
