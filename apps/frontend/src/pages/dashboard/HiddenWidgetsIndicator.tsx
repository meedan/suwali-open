import { FormattedMessage } from 'react-intl';

import Button from '@ui-components/input/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@ui-components/input/DropdownMenu';
import Icon from '@ui-components/layout/Icon';

type Props<T extends string> = {
  hiddenIds: T[];
  labels: Record<T, React.ReactNode>;
  onUnhide: (id: T) => void;
};

const HiddenWidgetsIndicator = <T extends string>({ hiddenIds, labels, onUnhide }: Props<T>) => {
  if (hiddenIds.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          iconRight={<Icon aria-hidden id="chevron_down" />}
          label={
            <FormattedMessage
              id="global.hiddenWidgetsCount"
              defaultMessage="{count, plural, one {# hidden widget} other {# hidden widgets}}"
              description="Button revealing the dashboard widgets hidden in this section, count shown separately"
              values={{ count: hiddenIds.length }}
            />
          }
          size="small"
          variant="text"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {hiddenIds.map((id) => (
          <DropdownMenuItem key={id}>
            <Button
              iconLeft={<Icon aria-hidden id="eye" />}
              label={labels[id]}
              size="medium"
              themeMode
              variant="menu"
              onClick={() => onUnhide(id)}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default HiddenWidgetsIndicator;
