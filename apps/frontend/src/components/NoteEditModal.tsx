import React, { lazy, Suspense, useState } from 'react';
import { FormattedDate, FormattedMessage } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';

import type { Note } from "@customTypes/note";

import { updateNote } from '@services/NotebooksService';

import Button from "@ui-components/input/Button";
import TextInput from '@ui-components/input/TextInput';
import HintBox from '@ui-components/layout/HintBox';
import { PanelLoading } from '@ui-components/layout/LoadingIndicator';
import MetaList from "@ui-components/layout/MetaList";

import type { MarkdownEditorRef } from '@components/MarkdownEditor';
import PreviewModalBase from '@components/PreviewModalBase';

const MarkdownEditor = lazy(() => import('@components/MarkdownEditor'));

type NoteEditModalProps = {
  note: Note;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewNoteSaved?: (payload: { title: string; content: string }) => void;
};

const NoteEditModal = ({
  note,
  open,
  onOpenChange,
  onNewNoteSaved,
}: NoteEditModalProps) => {
  const isNewNote = note.id === 0;

  const editorRef = React.useRef<MarkdownEditorRef>(null);
  const [editedTitle, setEditedTitle] = useState<string>(note.title);
  const [hasContent, setHasContent] = useState<boolean>(note.content.trim().length > 0);

  const queryClient = useQueryClient();
  const refetchItems = () => queryClient.invalidateQueries({ queryKey: [`/notebooks/${note.notebook_id}/items`] });
  const refetchNotebook = () => queryClient.invalidateQueries({ queryKey: [`/notebooks/${note.notebook_id}`] });

  const isSaveDisabled = !hasContent || editedTitle.trim().length === 0;

  const handleSave = () => {
    if (isSaveDisabled) return;

    const content = editorRef.current?.getMarkdown().trim() ?? '';

    if (isNewNote) {
      onNewNoteSaved?.({ title: editedTitle.trim(), content });
    } else {
      updateNote({
        ...note,
        title: editedTitle.trim(),
        content,
      }).then(() => {
        refetchItems();
        refetchNotebook();
      });
    }

    onOpenChange(false);
  };

  const handleCancel = () => onOpenChange?.(false);

  const content = (
    <>
      <HintBox
        type="warning"
        body={
          <FormattedMessage
            id="noteEditModal.deprecationWarning"
            defaultMessage="Editor’s notes are deprecated and any existing notes will become read-only in a future release. Please write directly in the notebook summary instead."
            description="Warning message displayed in the Note edit modal to inform users that Editor’s notes are deprecated and will become read-only in a future release"
          />
        }
      />
      <TextInput
        size="large"
        value={editedTitle}
        onChange={e => setEditedTitle(e.target.value)}
      />
      <Suspense fallback={<PanelLoading />}>
        <MarkdownEditor
          ref={editorRef}
          initialValue={note.content}
          isEditing
          onChange={(md) => setHasContent(md.trim().length > 0)}
        />
      </Suspense>
    </>
  );

  const footer = (
    <>
      <Button
        label={
          <FormattedMessage
            id="global.cancel"
            defaultMessage="Cancel"
            description="Reusable label for cancel buttons"
          />
        }
        variant="text"
        themeMode
        onClick={handleCancel}
      />
      <Button
        disabled={isSaveDisabled}
        label={
          <FormattedMessage
            id="global.notePanelsaveNote"
            defaultMessage="Save note"
            description="Submit button label for edit Note form"
          />
        }
        onClick={handleSave}
      />
    </>
  );

  return (
    <PreviewModalBase
      open={open}
      onOpenChange={onOpenChange}
      title={
        <FormattedMessage
          id="global.sourcenote"
          defaultMessage="Editor’s note"
          description="Label for the Note knowledge source item type"
        />
      }
      details={
        <>
          <FormattedMessage
            id="global.createdStrong"
            defaultMessage="<strong>Created:</strong> {modified}"
            description="Reusable label and date the item was created"
            tagName={MetaList.Item}
            values={{
              strong: msg => <strong key="strong">{msg}</strong>,
              modified: (
                <FormattedDate
                  key="modified"
                  weekday="short"
                  day="numeric"
                  hour="numeric"
                  minute="numeric"
                  month="short"
                  value={new Date(note.created_at)}
                />
              ),
            }}
          />
          <FormattedMessage
            id="global.modifiedStrong"
            defaultMessage="<strong>Modified:</strong> {modified}"
            description="Reusable label and date the item was modified"
            tagName={MetaList.Item}
            values={{
              strong: msg => <strong key="strong">{msg}</strong>,
              modified: (
                <FormattedDate
                  key="modified"
                  weekday="short"
                  day="numeric"
                  hour="numeric"
                  minute="numeric"
                  month="short"
                  value={new Date(note.updated_at)}
                />
              ),
            }}
          />
        </>
      }
      content={content}
      actions={footer}
    />
  );
};

export default NoteEditModal;
