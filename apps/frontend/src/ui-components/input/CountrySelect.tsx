import type { CountryCode } from 'libphonenumber-js';
import { useCallback, useMemo } from 'react';
import { defineMessages, useIntl } from 'react-intl';

import { type Country, getCountryList } from '@helpers/countries';
import { plainText } from '@helpers/search';

import SearchableSelect from './SearchableSelect';

const messages = defineMessages({
  triggerLabel: {
    id: 'countrySelect.triggerLabel',
    defaultMessage: 'Country: {country}',
    description: 'Accessible label of the button that opens the list of countries, with the name of the country that is chosen',
  },
});

// What is searched for is a country's name, its two-letter code, or its dial code, with or without the +
const matchesSearch = (country: Country, name: string, search: string) => {
  const digits = search.replace(/^\+/, '');
  if (/^\d+$/.test(digits)) return country.dialCode.startsWith(digits);
  return name.includes(search) || country.code.toLowerCase() === search;
};

type CountrySelectProps = {
  value: CountryCode;
  onValueChange: (country: CountryCode) => void;
  disabled?: boolean;
  className?: string;
};

// A country to choose from a list that can be searched by name, code or dial code. Closed, it shows the flag and dial
// code, as that is all there is room for beside a phone number.
export const CountrySelect = ({ value, onValueChange, disabled = false, className }: CountrySelectProps) => {
  const intl = useIntl();
  const countries = useMemo(() => getCountryList(intl.locale), [intl.locale]);
  const searchable = useMemo(() => countries.map(country => ({ country, name: plainText(country.name) })), [countries]);
  const selected = countries.find(({ code }) => code === value);

  const search = useCallback((typed: string) => {
    const found = searchable.filter(({ country, name }) => matchesSearch(country, name, typed));
    // The country whose code is what was typed comes first, then those whose name starts with it, as that is what is
    // most likely meant. Each group stays in the order of the list.
    const rank = ({ country, name }: (typeof searchable)[number]) => (country.code.toLowerCase() === typed ? 0 : name.startsWith(typed) ? 1 : 2);
    return found.map(item => ({ item, rank: rank(item) })).sort((a, b) => a.rank - b.rank).map(({ item }) => item.country);
  }, [searchable]);

  return (
    <SearchableSelect
      className={className}
      disabled={disabled}
      getAside={country => `+${country.dialCode}`}
      getName={country => `${country.flag} ${country.name}`}
      getValue={country => country.code}
      items={countries}
      onValueChange={country => onValueChange(country as CountryCode)}
      search={search}
      triggerContent={selected ? `${selected.flag} +${selected.dialCode}` : value}
      triggerLabel={intl.formatMessage(messages.triggerLabel, { country: selected?.name ?? value })}
      value={value}
    />
  );
};
