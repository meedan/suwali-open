import clsx from 'clsx';
import { FormattedMessage } from 'react-intl';

import { sameItems, splitList } from '@helpers/lists';

import Checkbox from '@ui-components/input/Checkbox';
import { Select, SelectItem } from '@ui-components/input/SelectInput';
import { ToggleGroup, ToggleGroupItem } from '@ui-components/input/ToggleGroup';

import styles from './FilterFields.module.css';
import { dateOptionMessages } from './filterOptions';

type FilterRowProps = {
  label: React.ReactNode;
  fill?: boolean;
  children: React.ReactNode;
};

export const FilterRow = ({ label, fill, children }: FilterRowProps) => (
  <div className={styles.filterRow}>
    <div className={styles.filterLabel}>{label}</div>
    <div className={clsx(fill && styles.filterWidget)}>{children}</div>
  </div>
);

type FilterOption = {
  value: string;
  label: React.ReactNode;
};

type ToggleFilterProps = {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
};

export const ToggleFilter = ({ options, value, onChange }: ToggleFilterProps) => (
  <ToggleGroup size="small" type="single" value={value} onValueChange={onChange}>
    {options.map(option => (
      <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>
    ))}
  </ToggleGroup>
);

type DateSelectProps = {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export const DateSelect = ({ value, onChange, disabled }: DateSelectProps) => (
  <Select size="small" value={value || 'any'} onValueChange={onChange} disabled={disabled}>
    {Object.entries(dateOptionMessages).map(([id, message]) => (
      <SelectItem key={id} value={id}>
        <FormattedMessage {...message} />
      </SelectItem>
    ))}
  </Select>
);

type CheckboxFilterProps = {
  options: FilterOption[];
  value?: string;
  defaultSelected?: string[];
  onChange: (value?: string) => void;
};

export const CheckboxFilter = ({ options, value, defaultSelected, onChange }: CheckboxFilterProps) => {
  const all = options.map(option => option.value);
  const fallback = (defaultSelected ?? all).filter(item => all.includes(item));
  const selected = value ? splitList(value).filter(item => all.includes(item)) : fallback;

  return (
    <>
      {options.map(option => (
        <Checkbox
          key={option.value}
          label={option.label}
          value={option.value}
          id={option.value}
          checked={selected.includes(option.value)}
          disabled={selected.length === 1 && selected.includes(option.value)}
          onChange={e => {
            const next = all.filter(item => (item === option.value ? e.target.checked : selected.includes(item)));
            onChange(sameItems(next, fallback) ? undefined : next.join(','));
          }}
        />
      ))}
    </>
  );
};
