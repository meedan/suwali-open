import React from "react";
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import type { Source } from "@customTypes/source";

import { getSourceTypeIcon, getSourceTypeName } from "@helpers/source";

import { useCan } from '@hooks/useCapabilities';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';
import ListItem from '@ui-components/layout/ListItem';
import StatusPrefix from "@ui-components/layout/StatusPrefix";
import Tooltip from '@ui-components/layout/Tooltip';

const messages = defineMessages({
  settings: {
    id: 'global.settingsSource',
    defaultMessage: 'Data source settings',
    description: 'Tooltip and label for button to open data source settings',
  },
});

interface SourceEntryProps {
  source: Source;
  isActive?: boolean;
  navigateAction?: boolean;
  onClick: (id: number) => void;
  onSettings?: (source: Source) => void;
};

const SourceEntry: React.FC<SourceEntryProps> = ({
  source,
  isActive,
  navigateAction,
  onClick,
  onSettings,
}) => {
  const intl = useIntl();
  const canUpdateSource = useCan('UPDATE_SOURCE').allowed;

  const handleClick = () => onClick(source.id);

  return (
    <ListItem
      type={
        <>
          {!source.active && <StatusPrefix status="paused" icon={false} sync />}
          {getSourceTypeName(source.source_type)}
        </>
      }
      isPaused={!source.active}
      icon={<Icon aria-hidden id={source.active ? getSourceTypeIcon(source.source_type) : 'pause'} />}
      title={source.name}
      caption={
        <>
          <FormattedMessage
            id="global.sourceEntryentriesCount"
            defaultMessage="{count, plural, =0 {0 Entries} one {1 Entry} other {# Entries}}"
            description="Caption with count of source documents"
            values={{ count: source.documents_count}}
          />
          {' / '}
          { source.last_synced_at ?
            <FormattedDate
              weekday="short"
              day="numeric"
              hour="numeric"
              minute="numeric"
              month="short"
              value={new Date(source.last_synced_at)}
            /> :
            <FormattedMessage
              id="global.neverSynced"
              defaultMessage="Not synced yet"
              description="Text shown when a source has never been synced"
            />
          }
        </>
      }
      hoverAction={
        source.source_type !== 'json_api' &&
        (source.source_type !== 'uploaded_files' || canUpdateSource) &&
        onSettings &&
        <Tooltip content={intl.formatMessage(messages.settings)}>
          <Button
            aria-label={intl.formatMessage(messages.settings)}
            className="no-mobile-access"
            iconLeft={<Icon aria-hidden id="settings" />}
            size="small"
            themeMode
            onClick={(e) => {
              e.stopPropagation();
              onSettings(source);
            }}
          />
        </Tooltip>
      }
      navigateAction={navigateAction}
      isActive={isActive}
      onClick={handleClick}
    />
  );
};

export default SourceEntry;
