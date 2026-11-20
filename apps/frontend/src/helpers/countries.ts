import { type CountryCode, getCountries, getCountryCallingCode } from 'libphonenumber-js';

export type Country = {
  code: CountryCode;
  name: string;
  dialCode: string;
  flag: string;
};

const getFlagEmoji = (code: CountryCode): string => (
  String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)))
);

export const getCountryList = (locale: string): Country[] => {
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  return getCountries()
    .map(code => ({
      code,
      name: regionNames.of(code) ?? code,
      dialCode: getCountryCallingCode(code),
      flag: getFlagEmoji(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
};

// Best-effort guess at the user's own country, used only to pre-select a sensible
// default in country pickers; the person filling in the form can always change it.
export const guessCountry = (): CountryCode => {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && (getCountries() as string[]).includes(region)) {
      return region as CountryCode;
    }
  } catch {
    // fall through to the default below
  }
  return 'US';
};
