import ChoiceCard, { type ChoiceCardBaseProps } from './ChoiceCard';

type RadioCardProps = ChoiceCardBaseProps & {
  // Cards that share a name are one group of radios, which is reached as a single tab stop and moved through with the arrow keys
  name: string;
};

const RadioCard = (props: RadioCardProps) => <ChoiceCard type="radio" {...props} />;

export default RadioCard;
