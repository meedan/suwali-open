import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { plainText } from '@helpers/search';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import { Popover, PopoverContent, PopoverTrigger } from '@ui-components/layout/Popover';
import listStyles from '@ui-components/layout/PopoverList.module.css';

import styles from './SearchableSelect.module.css';
import selectStyles from './SelectInput.module.css';
import TextInput from './TextInput';

type PickerProps<Item> = {
  items: Item[];
  value: string;
  getValue: (item: Item) => string;
  getName: (item: Item) => string;
  getAside: (item: Item) => string;
  // Takes what was typed, lower case and without accents, never empty, and returns the matches in the order to show them
  search: (typed: string) => Item[];
};

const messages = defineMessages({
  searchLabel: {
    id: 'global.searchLabel',
    defaultMessage: 'Search',
    description: 'Reusable accessible label of a field to search a list',
  },
  searchPlaceholder: {
    id: 'global.searchPlaceholder',
    defaultMessage: 'Search…',
    description: 'Reusable placeholder of a field to search a list',
  },
});

function Picker<Item>({ items, value, getValue, getName, getAside, search, onPick }: PickerProps<Item> & { onPick: (value: string) => void }) {
  const intl = useIntl();
  const [query, setQuery] = useState('');
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const typed = plainText(query.trim());
  const matches = useMemo(() => (typed ? search(typed) : items), [items, search, typed]);

  // Opened on the item that is chosen, as the list can be long
  useEffect(() => {
    optionRefs.current.find(node => node?.getAttribute('aria-current') === 'true')?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const focusOption = (index: number) => optionRefs.current[index]?.focus();

  return (
    <div className={listStyles.picker}>
      <TextInput
        inputProps={{ 'aria-label': intl.formatMessage(messages.searchLabel), autoComplete: 'off' }}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusOption(0);
          } else if (e.key === 'Enter') {
            // Not a submit of the form the field is in, whether or not there is an item to choose
            e.preventDefault();
            if (typed && matches.length > 0) onPick(getValue(matches[0]));
          }
        }}
        placeholder={intl.formatMessage(messages.searchPlaceholder)}
        ref={searchRef}
        value={query}
      />
      {matches.length === 0 ? (
        <FormattedMessage
          id="global.searchNoMatches"
          defaultMessage="Nothing matches your search."
          description="Reusable message shown when nothing in a list matches what was searched for"
          tagName="p"
        />
      ) : (
        <ul className={listStyles.list}>
          {matches.map((item, index) => {
            const itemValue = getValue(item);
            const chosen = itemValue === value;
            return (
              <li key={itemValue}>
                <Button
                  aria-current={chosen ? 'true' : undefined}
                  active={chosen}
                  iconRight={chosen ? <Icon id="check" aria-hidden /> : undefined}
                  label={
                    <span className={listStyles.option}>
                      <span className={listStyles.name} title={getName(item)}>{getName(item)}</span>
                      <span className={listStyles.aside}>{getAside(item)}</span>
                    </span>
                  }
                  onClick={() => onPick(itemValue)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      focusOption(index + 1);
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (index === 0) searchRef.current?.focus();
                      else focusOption(index - 1);
                    }
                  }}
                  ref={node => { optionRefs.current[index] = node; }}
                  size="small"
                  themeMode
                  variant="menu"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type SearchableSelectProps<Item> = PickerProps<Item> & {
  onValueChange: (value: string) => void;
  // What the closed select shows
  triggerContent: React.ReactNode;
  // Names the select with a visible label, or with triggerLabel when there is no room for one
  label?: React.ReactNode;
  triggerLabel?: string;
  disabled?: boolean;
  className?: string;
};

// An item to choose from a list that is searched as it is typed in, all of it being loaded already. Closed, it looks as a large select does.
function SearchableSelect<Item>({ onValueChange, triggerContent, label, triggerLabel, disabled = false, className, ...pickerProps }: SearchableSelectProps<Item>) {
  const id = useId();
  const labelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className={clsx('base-input-wrapper', className, selectStyles.sizeLarge, { disabled })}>
      {label && (
        <div className={selectStyles.titleWrapper}>
          <label className="base-label" htmlFor={id} id={labelId}>{label}</label>
        </div>
      )}
      {/* Modal, because a dialog this is in locks the scroll outside itself, and the list is shown outside it */}
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            aria-label={triggerLabel}
            aria-labelledby={label ? `${labelId} ${id}` : undefined}
            className={clsx('base-input', selectStyles.input, styles.trigger)}
            disabled={disabled}
            id={id}
            type="button"
          >
            <span className={styles.value}>{triggerContent}</span>
            <span className={selectStyles.iconWrapper}>
              <Icon id="chevron_down" className={selectStyles.icon} aria-hidden />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" arrow={false} holdSide className={clsx(listStyles.popover, styles.popover)}>
          <Picker
            {...pickerProps}
            onPick={(value) => {
              onValueChange(value);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default SearchableSelect;
