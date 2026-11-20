import { FormattedDate } from 'react-intl';

type PreviewDetailsDateProps = {
  value: string | number | Date;
};

// When something happened, in the form the details of an item show it. The year is left out
// for dates in the current year, and shown for any other so an older date isn't mistaken for a recent one.
const PreviewDetailsDate = ({ value }: PreviewDetailsDateProps) => {
  const date = new Date(value);
  const inCurrentYear = date.getFullYear() === new Date().getFullYear();

  return (
    <FormattedDate
      weekday="short"
      day="numeric"
      hour="numeric"
      minute="numeric"
      month="short"
      year={inCurrentYear ? undefined : 'numeric'}
      value={date}
    />
  );
};

export default PreviewDetailsDate;
