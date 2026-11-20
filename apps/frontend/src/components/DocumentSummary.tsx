import { lazy, Suspense, useState } from 'react';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { fetchAbout } from '@services/AboutService';

import { useToast } from '@hooks/useToast';

import Button from '@ui-components/input/Button';
import CharacterCount from '@ui-components/layout/CharacterCount';
import Icon from '@ui-components/layout/Icon';
import { PanelLoading } from '@ui-components/layout/LoadingIndicator';

import MarkdownPreview from '@components/MarkdownPreview';

import ConfirmSaveSummaryModal from './ConfirmSaveSummaryModal';
import styles from './DocumentSummary.module.css';
import PreviewDetails from './PreviewDetails';

const MarkdownEditor = lazy(() => import('@components/MarkdownEditor'));

// A long summary is read from the top, so editing starts there, rather than where the editor would put the cursor, at the end
const FOCUS_AT_START = { defaultSelection: 'rootStart' } as const;

const messages = defineMessages({
  editorLabel: {
    id: 'documentSummary.editorLabel',
    defaultMessage: 'Document summary',
    description: 'Accessible label of the editor where the summary of a document is edited',
  },
  saveSuccess: {
    id: 'documentSummary.saveSuccess',
    defaultMessage: 'Summary saved',
    description: 'Toast message when the summary of a document has been saved',
  },
  saveError: {
    id: 'documentSummary.saveError',
    defaultMessage: 'There was an error saving the summary. Please try again.',
    description: 'Toast message when saving the summary of a document fails',
  },
});

type DocumentSummaryProps = {
  summary: string;
  // Saves the new summary. Rejects when it could not be saved, which keeps the editor open for another try.
  onSave: (summary: string) => Promise<void>;
};

// The summary of a document, which can be read, and edited and saved after confirming
const DocumentSummary = ({ summary, onSave }: DocumentSummaryProps) => {
  const intl = useIntl();
  const { toast } = useToast();
  // Not known until the server has said, so nothing is counted or limited here before then, and the server still validates it
  const { data: about } = useQuery({ queryKey: ['/about'], queryFn: fetchAbout });
  const maxLength = about?.max_summary_length;

  const [saved, setSaved] = useState(summary);
  const [draft, setDraft] = useState(summary);
  // The editor writes the markdown its own way, so the saved summary as it first comes back from it is what an unchanged draft is
  const [unchanged, setUnchanged] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setDraft(saved);
    setUnchanged(null);
    setEditing(true);
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setSaved(draft);
      setEditing(false);
      toast('success', intl.formatMessage(messages.saveSuccess));
    } catch {
      toast('error', intl.formatMessage(messages.saveError));
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <PreviewDetails.Section
      editing={editing}
      title={
        <FormattedMessage
          id="documentSummary.title"
          defaultMessage="Summary"
          description="Heading of the summary of a document"
        />
      }
      action={!editing && (
        <Button
          iconLeft={<Icon aria-hidden id="pencil" />}
          label={
            <FormattedMessage
              id="global.edit"
              defaultMessage="Edit"
              description="Generic label for Edit action"
            />
          }
          size="small"
          themeMode
          onClick={startEditing}
        />
      )}
    >
      {editing ? (
        <>
          <Suspense fallback={<PanelLoading />}>
            <MarkdownEditor
              ariaLabel={intl.formatMessage(messages.editorLabel)}
              className={styles.editor}
              focusOptions={FOCUS_AT_START}
              initialValue={draft}
              isEditing
              onChange={setDraft}
              onReady={setUnchanged}
            />
          </Suspense>
          <div className={styles.footer}>
            <div className="base-help-container">
              {maxLength !== undefined && <span><CharacterCount count={draft.length} max={maxLength} /></span>}
            </div>
            <div className={styles.actions}>
              <Button
                label={
                  <FormattedMessage
                    id="global.cancel"
                    defaultMessage="Cancel"
                    description="Reusable label for cancel buttons"
                  />
                }
                onClick={() => setEditing(false)}
                size="small"
                themeMode
                variant="text"
              />
              <Button
                disabled={draft.trim() === '' || draft === saved || draft === unchanged || (maxLength !== undefined && draft.length > maxLength)}
                label={
                  <FormattedMessage
                    id="documentSummary.save"
                    defaultMessage="Save summary"
                    description="Button that saves the changes made to the summary of a document, after asking to confirm"
                  />
                }
                onClick={() => setConfirming(true)}
                size="small"
              />
            </div>
          </div>
        </>
      ) : saved ? (
        <div className={styles.text}>
          <MarkdownPreview className={styles.markdown} key={saved} content={saved} />
        </div>
      ) : (
        <p className={styles.empty}>
          <FormattedMessage
            id="documentSummary.empty"
            defaultMessage="No summary yet. Add one to give more context about this document."
            description="Shown in place of the summary of a document when it has none, inviting to write one with the Edit button"
          />
        </p>
      )}
      <ConfirmSaveSummaryModal
        open={confirming}
        saving={saving}
        onCancel={() => setConfirming(false)}
        onConfirm={handleConfirm}
      />
    </PreviewDetails.Section>
  );
};

export default DocumentSummary;
