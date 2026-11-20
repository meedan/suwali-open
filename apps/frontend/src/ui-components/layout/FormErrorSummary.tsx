import { FormattedMessage } from "react-intl";

const FormErrorSummary = ({ errors }: { errors: string[] }) => {
  if (errors.length === 0) return null;

  return (
    <div className="errors-container">
      <FormattedMessage
        id="global.formIssuesToFix"
        defaultMessage="There are some form issues that need to be fixed"
        description="Generic title for a form error summary"
        tagName="h3"
      />
      <ul>
        {errors.map(error => <li key={error}>{error}</li>)}
      </ul>
    </div>
  );
};

export default FormErrorSummary;
