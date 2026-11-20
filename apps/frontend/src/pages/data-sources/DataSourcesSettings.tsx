import React, { useState } from 'react';
import { defineMessages, FormattedDate, FormattedMessage, useIntl } from 'react-intl';
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import type { Source } from "@customTypes/source";

import { getNextSyncTime, getSourceTypeIcon } from '@helpers/source';

import { deleteSource, patchSource } from '@services/SourcesService';

import { useSession } from '@root/SessionContext';

import { useCan } from '@hooks/useCapabilities';
import { useHubPath } from '@hooks/useHubPath';
import { useNavigateWithRememberedParams } from "@hooks/useRememberedSearchParams";
import { useToast } from '@hooks/useToast';

import Button from "@ui-components/input/Button";
import Icon from "@ui-components/layout/Icon";
import MetaList from "@ui-components/layout/MetaList";
import StatusPrefix from "@ui-components/layout/StatusPrefix";
import WizardStepper from "@ui-components/layout/WizardStepper";

import { Can } from '@components/Can';
import ConfirmDeleteDataSourceModal from '@components/ConfirmDeleteDataSourceModal';
import ConfirmPauseModal from '@components/ConfirmPauseModal';
import EditableTitle from '@components/EditableTitle';

import type { WizardProps } from './DataSourcesCreateWizard';
import settingsStyles from "./DataSourcesSettings.module.css";
import GoogleDriveWizard from "./GoogleDriveWizard";
import RSSFeedWizard from "./RSSFeedWizard";
import UploadedFilesWizard from "./UploadedFilesWizard";
import WebsiteWizard from "./WebsiteWizard";
import styles from "./Wizard.module.css";
import WordpressWizard from "./WordpressWizard";

const messages = defineMessages({
  deleteSourceSuccess: {
    id: 'dataSourcesSettings.deleteSourceSuccess',
    defaultMessage: 'Data source removed',
    description: 'Toast message displayed when a data source was successfully deleted',
  },
  deleteSourceError: {
    id: 'dataSourcesSettings.deleteSourceError',
    defaultMessage: 'Error removing data source',
    description: 'Toast message displayed when there is an error deleting a data source',
  },
  pauseSourceSuccess: {
    id: 'dataSourcesSettings.pauseSourceSuccess',
    defaultMessage: 'Data source paused',
    description: 'Toast message displayed when a data source is successfully paused',
  },
  reactivateSourceSuccess: {
    id: 'dataSourcesSettings.reactivateSourceSuccess',
    defaultMessage: 'Data source reactivated',
    description: 'Toast message displayed when a data source is successfully reactivated',
  },
  pauseSourceError: {
    id: 'dataSourcesSettings.pauseSourceError',
    defaultMessage: 'Error updating data source status',
    description: 'Toast message displayed when there is an error pausing or reactivating a data source',
  },
  renameSourceError: {
    id: 'global.renameSourceError',
    defaultMessage: 'Failed to rename the source. Please try again.',
    description: 'Error message shown when there is an issue renaming a data source',
  },
});

type WizardComponentAndSteps = React.ComponentType<WizardProps> & { getWizardSteps: () => { label: React.ReactNode, description: React.ReactNode }[] };

const components: Record<Source['source_type'], WizardComponentAndSteps | null> = {
  rss_feed: RSSFeedWizard,
  uploaded_files: UploadedFilesWizard,
  google_drive_folder: GoogleDriveWizard,
  website: WebsiteWizard,
  conversation: null,
  json_api: null,
  wordpress_api: WordpressWizard,
};

const DataSourcesSettings = ({ source, onCreate }: { source: Source, onCreate: (sourceId: number) => void }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const hubId = session.currentHubId();
  const hubPath = useHubPath();
  const navigateWithRemembered = useNavigateWithRememberedParams(hubId);
  const intl = useIntl();
  const { toast } = useToast();

  const typeSteps = components[source.source_type]?.getWizardSteps();
  const initialStep = typeSteps ? typeSteps.length - 1 : 0;

  const [isEditing, setIsEditing] = useState(source.source_type === 'uploaded_files');
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [dataSourceToDelete, setDataSourceToDelete] = React.useState<Source | null>(null);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);

  const canUpdateSource = useCan('UPDATE_SOURCE').allowed;

  if (!typeSteps) return null;

  const handlePauseConfirm = async () => {
    const nextActiveState = !source.active;

    try {
      await patchSource(source.id, { source: { active: nextActiveState } });
      queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/sources`] });

      if (nextActiveState) {
        toast('success', intl.formatMessage(messages.reactivateSourceSuccess));
      } else {
        toast('success', intl.formatMessage(messages.pauseSourceSuccess));
      }
    } catch (error) {
      console.error('Error updating source status:', error);
      toast('error', intl.formatMessage(messages.pauseSourceError));
    } finally {
      setPauseModalOpen(false);
    }
  };

  const handleSaveTitle = async (newTitle: string) => {
    try {
      await patchSource(source.id, { source: { name: newTitle } });
      queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/sources`] });
    } catch {
      toast('error', intl.formatMessage(messages.renameSourceError));
    }
  };

  const wizardProps = {
    source,
    currentStep,
    onCancel: () => {
      setIsEditing(source.source_type === 'uploaded_files');
      setCurrentStep(initialStep);
    },
    onCreate,
    onStepChange: setCurrentStep,
    readOnly: !isEditing,
    isEditing,
  } as WizardProps;

  return (
    <div className="layout-main-column-scrollable-area">
      <ConfirmDeleteDataSourceModal
        open={Boolean(dataSourceToDelete)}
        source={dataSourceToDelete}
        onCancel={() => setDataSourceToDelete(null)}
        onConfirm={async () => {
          try {
            await deleteSource({ sourceId: dataSourceToDelete!.id });
            // Refresh hub data to update capabilities (e.g., external_data_sources_count)
            await queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}`]});
            await queryClient.invalidateQueries({ queryKey: [`/hubs/${hubId}/sources`] });
            toast('success', intl.formatMessage(messages.deleteSourceSuccess));
            navigate(hubPath('/data-sources'), {replace: true});
          } catch {
            toast('error', intl.formatMessage(messages.deleteSourceError));
          } finally {
            setDataSourceToDelete(null);
          }
        }}
      />
      <ConfirmPauseModal
        open={pauseModalOpen}
        paused={source.active === false}
        entityTitle={source.name}
        entityType="Source"
        onCancel={() => setPauseModalOpen(false)}
        onConfirm={handlePauseConfirm}
      />
      <div className={styles.wizardHeader}>
        <div className={settingsStyles.sourceHeaderMainRow}>
          <div className={settingsStyles.sourceSettingsTitleWrapper}>
            <EditableTitle
              icon={<Icon aria-hidden id={getSourceTypeIcon(source.source_type)} />}
              value={source.name}
              canEdit={canUpdateSource}
              onSave={handleSaveTitle}
              renderMeta={
                source.source_type === 'uploaded_files' ?
                  <MetaList>
                    <FormattedMessage
                      id="dataSourcesSettings.entriesLabel"
                      defaultMessage="<strong>Entries:</strong> {count}"
                      description="Entries label"
                      tagName={MetaList.Item}
                      values={{
                        strong: msg => <strong key="strong">{msg}</strong>,
                        count: source.documents_count,
                      }}
                    />
                    {source.last_synced_at && (
                      <FormattedMessage
                        id="global.lastUploadLabel"
                        defaultMessage="<strong>Last upload:</strong> {date}"
                        description="Last upload label"
                        tagName={MetaList.Item}
                        values={{
                          strong: msg => <strong key="strong">{msg}</strong>,
                          date:
                            <FormattedDate
                              key="date"
                              value={new Date(source.last_synced_at)}
                              weekday="short"
                              month="short"
                              day="2-digit"
                              hour="2-digit"
                              minute="2-digit"
                            />
                        }}
                      />
                    )}
                  </MetaList>
                :
                  <MetaList>
                    {!source.active &&
                      <MetaList.Item>
                        <StatusPrefix status="paused" hyphen={false} sync />
                      </MetaList.Item>
                    }
                    <FormattedMessage
                      id="dataSourcesSettings.entriesLabel"
                      defaultMessage="<strong>Entries:</strong> {count}"
                      description="Entries label"
                      tagName={MetaList.Item}
                      values={{
                        strong: msg => <strong key="strong">{msg}</strong>,
                        count: source.documents_count,
                      }}
                    />
                    {source.last_synced_at && (
                      <FormattedMessage
                        id="global.lastSyncLabel"
                        defaultMessage="<strong>Last sync:</strong> {date}"
                        description="Last sync label"
                        tagName={MetaList.Item}
                        values={{
                          strong: msg => <strong key="strong">{msg}</strong>,
                          date:
                            <FormattedDate
                              key="date"
                              value={new Date(source.last_synced_at)}
                              weekday="short"
                              month="short"
                              day="2-digit"
                              hour="2-digit"
                              minute="2-digit"
                            />
                        }}
                      />
                    )}
                    <FormattedMessage
                      id="global.nextSyncLabel"
                      defaultMessage="<strong>Next scheduled sync:</strong> {date}"
                      description="Next sync label showing the upcoming scheduled sync time at :00 or :30 of the hour"
                      tagName={MetaList.Item}
                      values={{
                        strong: msg => <strong key="strong">{msg}</strong>,
                        date:
                          <FormattedDate
                            key="date"
                            value={getNextSyncTime()}
                            hour="2-digit"
                            minute="2-digit"
                          />
                      }}
                    />
                  </MetaList>
              }
            />
            <div className={settingsStyles.sourceSettingsTitleActions}>
              <Button
                iconLeft={<Icon id="list" />}
                label={
                  <FormattedMessage
                    id="global.viewEntries"
                    defaultMessage="View entries"
                    description="generic label for buttons to tell the user they can view the list of entries in a data source"
                  />
                }
                size="small"
                themeMode
                onClick={() => {
                  navigateWithRemembered(`/data-sources/${source.id}`);
                }}
              />
            </div>
          </div>
          <div className={settingsStyles.sourceSettingsActions}>
            {source.source_type === 'uploaded_files' ?
              <>
                <Can action="REMOVE_SOURCE">
                  <Button
                    variant="filled"
                    themeMode
                    size="small"
                    iconLeft={<Icon id="x" />}
                    label={
                      <FormattedMessage
                        id="global.removeSource"
                        defaultMessage="Remove data source"
                        description="Reusable label for remove data source action"
                      />
                    }
                    onClick={() => setDataSourceToDelete(source)}
                  />
                </Can>
              </>
            :
              <>
                <Can action="UPDATE_SOURCE">
                  <Button
                    disabled={isEditing}
                    size="small"
                    iconLeft={<Icon aria-hidden id="pencil" />}
                    label={
                      <FormattedMessage
                        id="global.edit"
                        defaultMessage="Edit"
                        description="Generic label for Edit action"
                      />
                    }
                    onClick={() => {
                      setCurrentStep(0);
                      setIsEditing(true);
                    }}
                    themeMode
                  />
                </Can>
                <Button
                  size="small"
                  iconLeft={<Icon id={source.active ? 'pause' : 'play'} />}
                  label={
                    source.active ? (
                      <FormattedMessage
                        id="global.pauseSyncing"
                        defaultMessage="Pause syncing"
                        description="Reusable label for pause syncing action"
                      />
                    ) : (
                      <FormattedMessage
                        id="dataSourceSettings.reactivate"
                        defaultMessage="Resume syncing"
                        description="Button label for resume syncing a data source"
                        />
                    )
                  }
                  onClick={() => setPauseModalOpen(true)}
                  {...(source.active ? { variant: 'filled', themeMode: true } : {})}
                />
                <Can action="REMOVE_SOURCE">
                  <Button
                    variant="filled"
                    themeMode
                    size="small"
                    iconLeft={<Icon id="x" />}
                    label={
                      <FormattedMessage
                        id="global.removeSource"
                        defaultMessage="Remove data source"
                        description="Reusable label for remove data source action"
                      />
                    }
                    onClick={() => setDataSourceToDelete(source)}
                  />
                </Can>
              </>
            }
          </div>
        </div>
      </div>
      <div className={styles.wizardMainLayout}>
        {isEditing && !['uploaded_files', 'google_drive_folder'].includes(source.source_type) && <WizardStepper currentStep={isEditing ? currentStep : typeSteps.length} steps={typeSteps} />}
        {source.source_type === 'rss_feed' && <RSSFeedWizard  {...wizardProps} />}
        {source.source_type === 'uploaded_files' && <UploadedFilesWizard  {...wizardProps} />}
        {source.source_type === 'google_drive_folder' && <GoogleDriveWizard  {...wizardProps} />}
        {source.source_type === 'website' && <WebsiteWizard  {...wizardProps} />}
        {source.source_type === 'wordpress_api' && <WordpressWizard  {...wizardProps} />}
      </div>
    </div>
  );
};

export default DataSourcesSettings;
