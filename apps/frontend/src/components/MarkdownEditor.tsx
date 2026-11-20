import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  headingsPlugin,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  Separator,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor';

import styles from './MarkdownEditor.module.css';

import '@styles/vendor-mdxeditor.css';

const messages = defineMessages({
  'contentArea.editableMarkdown': {
    id: 'mdxeditor.contentArea.editableMarkdown',
    defaultMessage: 'editable markdown',
    description: 'Accessible label for the editable text area of the rich text (markdown) editor',
  },
  'toolbar.bold': {
    id: 'mdxeditor.toolbar.bold',
    defaultMessage: 'Bold',
    description: 'Rich text editor toolbar button label to make the selected text bold',
  },
  'toolbar.removeBold': {
    id: 'mdxeditor.toolbar.removeBold',
    defaultMessage: 'Remove bold',
    description: 'Rich text editor toolbar button label to remove bold formatting, shown when the selected text is already bold',
  },
  'toolbar.italic': {
    id: 'mdxeditor.toolbar.italic',
    defaultMessage: 'Italic',
    description: 'Rich text editor toolbar button label to make the selected text italic',
  },
  'toolbar.removeItalic': {
    id: 'mdxeditor.toolbar.removeItalic',
    defaultMessage: 'Remove italic',
    description: 'Rich text editor toolbar button label to remove italic formatting, shown when the selected text is already italic',
  },
  'toolbar.underline': {
    id: 'mdxeditor.toolbar.underline',
    defaultMessage: 'Underline',
    description: 'Rich text editor toolbar button label to underline the selected text',
  },
  'toolbar.removeUnderline': {
    id: 'mdxeditor.toolbar.removeUnderline',
    defaultMessage: 'Remove underline',
    description: 'Rich text editor toolbar button label to remove underline formatting, shown when the selected text is already underlined',
  },
  'toolbar.bulletedList': {
    id: 'mdxeditor.toolbar.bulletedList',
    defaultMessage: 'Bulleted list',
    description: 'Rich text editor toolbar button label to turn the selected lines into a bulleted list',
  },
  'toolbar.numberedList': {
    id: 'mdxeditor.toolbar.numberedList',
    defaultMessage: 'Numbered list',
    description: 'Rich text editor toolbar button label to turn the selected lines into a numbered list',
  },
  'toolbar.checkList': {
    id: 'mdxeditor.toolbar.checkList',
    defaultMessage: 'Check list',
    description: 'Rich text editor toolbar button label to turn the selected lines into a check list of items that can be ticked off',
  },
  'toolbar.toggleGroup': {
    id: 'mdxeditor.toolbar.toggleGroup',
    defaultMessage: 'Toggle group',
    description: 'Accessible label for a group of toggle buttons in the rich text editor toolbar',
  },
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': {
    id: 'mdxeditor.toolbar.blockTypeSelect.selectBlockTypeTooltip',
    defaultMessage: 'Select block type',
    description: 'Tooltip for the dropdown in the rich text editor toolbar that changes the type of the current block, such as paragraph, quote or heading',
  },
  'toolbar.blockTypeSelect.placeholder': {
    id: 'mdxeditor.toolbar.blockTypeSelect.placeholder',
    defaultMessage: 'Block type',
    description: 'Placeholder shown in the block type dropdown of the rich text editor toolbar when no block type is selected',
  },
  'toolbar.blockTypes.paragraph': {
    id: 'mdxeditor.toolbar.blockTypes.paragraph',
    defaultMessage: 'Paragraph',
    description: 'Option in the rich text editor block type dropdown for regular body text',
  },
  'toolbar.blockTypes.quote': {
    id: 'mdxeditor.toolbar.blockTypes.quote',
    defaultMessage: 'Quote',
    description: 'Option in the rich text editor block type dropdown for a quoted passage of text',
  },
  'toolbar.blockTypes.heading': {
    id: 'mdxeditor.toolbar.blockTypes.heading',
    defaultMessage: 'Heading {level}',
    description: 'Option in the rich text editor block type dropdown for a section heading. {level} is the heading level number, for example 1 for the largest heading',
  },
  'toolbar.thematicBreak': {
    id: 'mdxeditor.toolbar.thematicBreak',
    defaultMessage: 'Horizontal line',
    description: 'Rich text editor toolbar button label to insert a horizontal line that separates sections of the text',
  },
  'toolbar.link': {
    id: 'mdxeditor.toolbar.link',
    defaultMessage: 'Link',
    description: 'Rich text editor toolbar button label to turn the selected text into a link',
  },
  'createLink.text': {
    id: 'mdxeditor.createLink.text',
    defaultMessage: 'Link text',
    description: 'Label for the field in the rich text editor link dialog where the visible text of the link is entered',
  },
  'createLink.title': {
    id: 'mdxeditor.createLink.title',
    defaultMessage: 'Link title',
    description: 'Label for the field in the rich text editor link dialog where the title of the link, shown as a tooltip, is entered',
  },
  'linkPreview.copyToClipboard': {
    id: 'mdxeditor.linkPreview.copyToClipboard',
    defaultMessage: 'Copy to clipboard',
    description: 'Tooltip for the button in the rich text editor link preview that copies the link URL to the clipboard',
  },
  'linkPreview.remove': {
    id: 'mdxeditor.linkPreview.remove',
    defaultMessage: 'Remove link',
    description: 'Tooltip for the button in the rich text editor link preview that removes the link but keeps its text',
  },
  'linkPreview.edit': {
    id: 'mdxeditor.linkPreview.edit',
    defaultMessage: 'Edit link URL',
    description: 'Tooltip for the button in the rich text editor link preview that opens the dialog to change the link URL',
  },
  'linkPreview.copied': {
    id: 'mdxeditor.linkPreview.copied',
    defaultMessage: 'Copied!',
    description: 'Confirmation shown in the rich text editor link preview after the link URL was copied to the clipboard',
  },
  'dialogControls.save': {
    id: 'mdxeditor.linkPreview.save',
    defaultMessage: 'Save',
    description: 'Button label to save the changes in the rich text editor link dialog',
  },
  'dialogControls.cancel': {
    id: 'mdxeditor.linkPreview.cancel',
    defaultMessage: 'Cancel',
    description: 'Button label to close the rich text editor link dialog without saving changes',
  },
  'toolbar.source': {
    id: 'mdxeditor.source',
    defaultMessage: 'Markdown source',
    description: 'Label for the rich text editor view that shows the raw markdown source of the text instead of the formatted text',
  }
}) as Record<string, object>;

export interface MarkdownEditorRef {
  getMarkdown(): string;
};

type FocusOptions = NonNullable<Parameters<MDXEditorMethods['focus']>[1]>;

interface MarkdownEditorProps {
  // Accessible name of the editable area, in place of the generic one
  ariaLabel?: string,
  className?: string,
  // Where the cursor goes when the editor takes focus. Without it, the editor's own default applies
  focusOptions?: FocusOptions,
  initialValue: string,
  isEditing?: boolean;
  onChange?: (md: string) => void;
  // Called once the editor has loaded, with the markdown as the editor writes it. That can differ from the markdown it was given,
  // such as in the list markers used, and onChange only reports it when it does
  onReady?: (md: string) => void;
  onError?: (payload: { error: string; source: string }) => void;
};

const MarkdownEditor = forwardRef(({
  ariaLabel,
  className,
  focusOptions,
  initialValue,
  isEditing = false,
  onChange = () => {},
  onReady,
  onError,
}: MarkdownEditorProps, ref) => {
  const intl = useIntl();
  const mdxRef = useRef<MDXEditorMethods>(null);

  useImperativeHandle(ref, () => ({
    getMarkdown() {
      return mdxRef.current?.getMarkdown() ?? "";
    }
  }));

  useEffect(() => {
    if (!isEditing) return;

    const id = requestAnimationFrame(() => {
      mdxRef.current?.focus(undefined, focusOptions);
    });

    return () => cancelAnimationFrame(id);
  }, [isEditing, focusOptions]);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      onReadyRef.current?.(mdxRef.current?.getMarkdown() ?? '');
    });

    return () => cancelAnimationFrame(id);
  }, []);

  const mdxEditorPlugins = useMemo(() => {
    const base = [
      diffSourcePlugin({ viewMode: 'rich-text' }),
      headingsPlugin({
        allowedHeadingLevels: [1, 2, 3, 4],
      }),
      markdownShortcutPlugin(),
      linkDialogPlugin(),
      linkPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
    ];

    if (!isEditing) return base;

    const toolbar = toolbarPlugin({
      toolbarClassName: 'markdown-editor__toolbar',
      toolbarContents: () => (
        <DiffSourceToggleWrapper options={["rich-text", "source"]}>
          <div className="mdx-toolbar-group-wrapper">
            <BoldItalicUnderlineToggles />
            <CreateLink />
          </div>
          <Separator />
          <InsertThematicBreak />
          <Separator />
          <div className="mdx-toolbar-group-wrapper">
            <ListsToggle options={["bullet", "number"]} />
          </div>
          <Separator />
          <BlockTypeSelect />
        </DiffSourceToggleWrapper>
      )
    });

    return [...base, toolbar];
  }, [isEditing]);

  return (
    <MDXEditor
      ref={mdxRef}
      autoFocus={focusOptions ?? true} // eslint-disable-line jsx-a11y/no-autofocus
      translation={(key, original, values) => {
        if (ariaLabel && key === 'contentArea.editableMarkdown') return ariaLabel;
        return intl.formatMessage(
          messages[key] ??
          {
            id: `mdxeditor.${key}`,
            defaultMessage: original,
          },
          values,
        );
      }}
      contentEditableClassName='markdown-editor__content-editable'
      className={clsx(styles.markdownEditor, className, {
        [styles.editMode]: isEditing,
      })}
      key={`editing-${isEditing}`}
      readOnly={!isEditing}
      plugins={mdxEditorPlugins}
      markdown={initialValue}
      suppressHtmlProcessing
      onChange={onChange}
      onError={onError}
    />
  );
});

export default MarkdownEditor;
