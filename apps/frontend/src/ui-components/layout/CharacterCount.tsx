import { FormattedMessage } from 'react-intl';

type CharacterCountProps = {
  count: number;
  max: number;
};

// How much of what is allowed has been typed, as help under a field that has a limit
const CharacterCount = ({ count, max }: CharacterCountProps) => (
  <FormattedMessage
    id="global.characterCount"
    defaultMessage="{count, number} / {max, number} characters"
    description="How many characters of the most allowed have been typed in a field that has a limit. Example: 42 / 200 characters"
    values={{ count, max }}
  />
);

export default CharacterCount;
