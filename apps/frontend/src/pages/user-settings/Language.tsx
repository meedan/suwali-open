import { useState } from 'react';
import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import { LanguageSelect } from '@ui-components/input/LanguageSelect';

import { useI18n } from '@components/LanguageProvider';

import settingsStyles from '@pages/Settings.module.css'

const Language = () => {
  const { locale, setLocale } = useI18n();
  const [selectedLanguage, setSelectedLanguage] = useState<string>(locale);

  return (
    <>
      <FormattedMessage
        id="global.languagelanguageTitle"
        defaultMessage="Interface language"
        description="Title of area for changing the language the interface is displayed in"
        tagName="h3"
      />
      <FormattedMessage
        id="global.languagelanguageInstructions"
        defaultMessage="Select the language in which the interface will be displayed. This setting only applies to this web interface, not to your chatbot."
        description="Instructions on how change the language of the interface"
        tagName="p"
      />
      <LanguageSelect value={selectedLanguage} onChange={(value) => setSelectedLanguage(value)} />
      <div className={settingsStyles.buttonWrapper}>
        <Button
          label={
            <FormattedMessage
              id="global.languageupdateButton"
              defaultMessage="Update language"
              description="Button label for changing the interface language"
            />
          }
          size="medium"
          onClick={() => setLocale(selectedLanguage)}
        />
      </div>
    </>
  );
};

export default Language;
