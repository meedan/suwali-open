import { FormattedDate, FormattedMessage } from 'react-intl';

import type { ExternalResource } from '@customTypes/external-resource';

import MetaList from '@ui-components/layout/MetaList';

const MINUTE = 60 * 1000;

const date = (value: string) => <FormattedDate key="date" value={new Date(value)} month="short" day="numeric" year="numeric" />;

// When the resource was added and, once it has been edited since, when it last changed
const ExternalResourceMeta = ({ resource }: { resource: ExternalResource }) => {
  const { created_at: createdAt, updated_at: updatedAt } = resource;
  const edited = createdAt && updatedAt && new Date(updatedAt).getTime() - new Date(createdAt).getTime() > MINUTE;

  if (!createdAt) return null;

  return (
    <MetaList>
      <FormattedMessage
        id="global.resourceAddedOn"
        defaultMessage="<strong>Added:</strong> {date}"
        description="When an external resource was created"
        tagName={MetaList.Item}
        values={{ date: date(createdAt), strong: msg => <strong key="strong">{msg}</strong> }}
      />
      {edited && (
        <FormattedMessage
          id="global.resourceUpdatedOn"
          defaultMessage="<strong>Updated:</strong> {date}"
          description="When an external resource was last edited"
          tagName={MetaList.Item}
          values={{ date: date(updatedAt), strong: msg => <strong key="strong">{msg}</strong> }}
        />
      )}
    </MetaList>
  );
};

export default ExternalResourceMeta;
