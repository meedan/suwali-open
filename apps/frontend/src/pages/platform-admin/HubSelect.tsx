import { useCallback, useMemo } from 'react';
import { FormattedMessage } from 'react-intl';

import { plainText } from '@helpers/search';

import type { AdminHub } from '@services/AdminService';

import SearchableSelect from '@ui-components/input/SearchableSelect';

type Hub = Pick<AdminHub, 'id' | 'name'>;

type HubSelectProps = {
  disabled?: boolean;
  hubs: Hub[];
  label?: React.ReactNode;
  triggerLabel?: string;
  onPick: (hubId: string) => void;
  value: string;
};

const HubSelect = ({ disabled = false, hubs, label, onPick, triggerLabel, value }: HubSelectProps) => {
  const searchable = useMemo(() => hubs.map(hub => ({ hub, text: plainText(hub.name) })), [hubs]);
  const selected = hubs.find(hub => String(hub.id) === value);

  const search = useCallback(
    (typed: string) => searchable.filter(({ hub, text }) => text.includes(typed) || String(hub.id) === typed).map(({ hub }) => hub),
    [searchable],
  );

  return (
    <SearchableSelect
      disabled={disabled}
      getAside={hub => `#${hub.id}`}
      getName={hub => hub.name}
      getValue={hub => String(hub.id)}
      items={hubs}
      label={label}
      triggerLabel={triggerLabel}
      onValueChange={onPick}
      search={search}
      triggerContent={selected ? selected.name : (
        <FormattedMessage
          id="admin.hubSelect.placeholder"
          defaultMessage="Select a hub"
          description="Shown in the closed hub selector on the platform admin pages until a hub is chosen"
        />
      )}
      value={value}
    />
  );
};

export default HubSelect;
