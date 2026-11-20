import { FormattedMessage } from 'react-intl';

import { Select, SelectItem } from "./SelectInput";

type LanguageSelectProps = {
  value: string;
  onChange: (value: string) => void;
};

export const LanguageSelect = ({ value, onChange }: LanguageSelectProps) => (
  <Select
    label={
      <FormattedMessage
        id="global.languageSelectcurrentLanguage"
        defaultMessage="Current language"
        description="Label for select input to select the language the UI will appear in"
      />
    }
    size="large"
    value={value}
    onValueChange={newValue => onChange(newValue)}
  >
    <SelectItem value="en">English</SelectItem>
    <SelectItem value="ar">العربية</SelectItem>
    <SelectItem value="es">Español</SelectItem>
    <SelectItem value="fr">Français</SelectItem>
    <SelectItem value="hi">हिन्दी</SelectItem>
    <SelectItem value="pt">Português</SelectItem>
  </Select>
);
