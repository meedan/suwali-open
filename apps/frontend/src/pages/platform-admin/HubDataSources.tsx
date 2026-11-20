import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import { datetimeFormatOptions, formatLimit, getDocumentActivityStatus, getStatusTooltip } from '@helpers/platform-admin';

import type { AdminHubDetail } from '@services/AdminService';

import Button from '@ui-components/input/Button';
import Icon from '@ui-components/layout/Icon';

import { Can } from '@components/Can';

import StatusValue from './StatusValue';

const messages = defineMessages({
  unrestricted: {
    id: 'admin.unrestricted',
    defaultMessage: 'unrestricted',
    description: 'Label shown in place of a numeric limit when there is no restriction on a hub',
  },
  editSources: {
    id: 'admin.updateCustomLimitsModal.sourcesTitle',
    defaultMessage: 'Update max data sources?',
    description: 'Title of the modal for updating the data sources custom limit',
  },
  editDocuments: {
    id: 'admin.updateCustomLimitsModal.documentsTitle',
    defaultMessage: 'Update max documents?',
    description: 'Title of the modal for updating the documents custom limit',
  },
});

interface HubDataSourcesProps {
  hub: AdminHubDetail;
  onEditSources: () => void;
  onEditDocuments: () => void;
}

const HubDataSources = ({ hub, onEditSources, onEditDocuments }: HubDataSourcesProps) => {
  const intl = useIntl();
  const unlimitedLabel = intl.formatMessage(messages.unrestricted);
  const lastDocStatus = getDocumentActivityStatus(hub.last_document_added_at);

  return (
    <section>
      <FormattedMessage
        id="global.dataSources"
        defaultMessage="Data sources"
        description="Reusable label for Data Sources page or list title"
        tagName="h2"
      />
      <dl>
        <div>
          <FormattedMessage
            id="global.dataSources"
            defaultMessage="Data sources"
            description="Reusable label for Data Sources page or list title"
            tagName="dt"
          />
          <dd>
            <StatusValue status={hub.sources_count === 0 ? 'pink' : null}>
              {formatLimit(hub.sources_count, hub.max_sources, unlimitedLabel)}
            </StatusValue>
          </dd>
          {hub.plan === 'enterprise' && (
            <Can action="IS_WRITE_ADMIN">
              <Button
                aria-label={intl.formatMessage(messages.editSources)}
                title={intl.formatMessage(messages.editSources)}
                iconLeft={<Icon aria-hidden id="pencil" />}
                size="small"
                themeMode
                variant="filled"
                onClick={onEditSources}
              />
            </Can>
          )}
        </div>
        <div>
          <FormattedMessage
            id="global.documents"
            defaultMessage="Documents"
            description="Reusable label for documents page or list title"
            tagName="dt"
          />
          <dd>
            <StatusValue status={hub.documents_count === 0 ? 'pink' : null}>
              {formatLimit(hub.documents_count, hub.max_documents, unlimitedLabel)}
            </StatusValue>
          </dd>
          {hub.plan === 'enterprise' && (
            <Can action="IS_WRITE_ADMIN">
              <Button
                aria-label={intl.formatMessage(messages.editDocuments)}
                title={intl.formatMessage(messages.editDocuments)}
                iconLeft={<Icon aria-hidden id="pencil" />}
                size="small"
                themeMode
                variant="filled"
                onClick={onEditDocuments}
              />
            </Can>
          )}
        </div>
        <div>
          <FormattedMessage
            id="admin.hubDetailDocumentErrors"
            defaultMessage="Documents with errors"
            description="Label for the document sync error count on the hub detail page"
            tagName="dt"
          />
          <dd>
            <StatusValue status={hub.document_errors_count > 0 ? 'pink' : null}>
              {hub.document_errors_count}
            </StatusValue>
          </dd>
        </div>
        <div>
          <FormattedMessage
            id="admin.hubDetailLastDocumentAdded"
            defaultMessage="Last document added"
            description="Label for the most recently added document datetime on the hub detail page"
            tagName="dt"
          />
          <dd>
            <StatusValue
              status={lastDocStatus}
              tooltip={hub.last_document_added_at
                ? (
                  <FormattedMessage
                    {...getStatusTooltip('documents', lastDocStatus)}
                    values={{
                      date: (
                        <time
                          key="date"
                          dateTime={hub.last_document_added_at}
                        >
                          <FormattedDate value={hub.last_document_added_at} {...datetimeFormatOptions} />
                        </time>
                      )
                    }}
                  />
                )
                :
                  <FormattedMessage
                    id="admin.hubDetailNeverDocumentAdded"
                    defaultMessage="No documents have been added yet"
                    description="Tooltip shown on the last document added row when no documents have ever been added"
                  />
              }
            >
              {hub.last_document_added_at
                ? <FormattedDate value={hub.last_document_added_at} {...datetimeFormatOptions} />
                : '—'
              }
            </StatusValue>
          </dd>
        </div>
      </dl>
    </section>
  );
};

export default HubDataSources;
