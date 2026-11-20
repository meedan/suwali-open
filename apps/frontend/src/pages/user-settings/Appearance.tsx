import { FormattedMessage } from 'react-intl';

import ThemeToggle from '@ui-components/input/ThemeToggle';

const Appearance = () => {
  return (
    <>
      <FormattedMessage
        id="global.appearanceappearanceTitle"
        defaultMessage="Interface theme"
        description="Title of area for changing the theme appearance the interface is displayed in"
        tagName="h3"
      />
      <FormattedMessage
        id="global.appearancechoose"
        defaultMessage="Choose how the interface looks to you. Select light, dark, or to follow your system settings."
        description="Introduction text to changing the UI theme"
        tagName="p"
      />
      <FormattedMessage
        id="global.appearanceselections"
        defaultMessage="Selections are applied immediately and saved automatically."
        description="Description that changing the UI theme happens right away"
        tagName="p"
      />
      <br />
      <br />
      <ThemeToggle full />
    </>
  );
};

export default Appearance;
