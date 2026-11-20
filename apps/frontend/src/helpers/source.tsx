import { FormattedMessage } from "react-intl";

import type { NotebookItem } from "@customTypes/notebook-item";
import type { Source } from "@customTypes/source";

import { getConversationTitle } from "./conversation";

export const getNotebookItemLabel = (notebookItem: NotebookItem): string => {
  switch (notebookItem.item_type) {
    case 'Conversation': return getConversationTitle(notebookItem.item);
    case 'Contribution': return notebookItem.item.content;
    case 'Document': return notebookItem.item.title;
    case 'Message': return notebookItem.item.body;
    case 'MessageCluster': return notebookItem.item.last_message_body;
    case 'Note': return notebookItem.item.title;
    case 'Notebook': return notebookItem.item.name;
  }
};

export const getSourceTypeName = (source: string): string => {
  switch (source) {
    case 'google_drive_folder':
      return 'Google Drive';
    case 'website':
      return 'Website';
    case 'rss_feed':
      return 'RSS feed';
    case 'json_api':
      return 'JSON API';
    case 'wordpress_api':
      return 'WordPress';
    case 'uploaded_files':
      return 'Files';
    default:
      return source.charAt(0).toUpperCase() + source.slice(1);
  }
}

export const getSourceTypeIcon = (source: string): string => {
  switch (source) {
    case 'google_drive_folder':
      return 'google_drive';
    case 'website':
      return 'website_source';
    case 'rss_feed':
      return 'rss_source';
    case 'json_api':
      return 'api_source';
    case 'wordpress_api':
      return 'wordpress_source';
    case 'uploaded_files':
      return 'upload_source';
    default:
      return 'graph';
  }
}

export const sourceSupportsPublishedAt = (sourceType: Source['source_type']): boolean => {
  return ['rss_feed', 'json_api', 'google_drive_folder', 'wordpress_api'].includes(sourceType);
}

export const getNotebookItemTypeIconId = (itemType: string): string => {
  return ({
    Contribution: 'users',
    Conversation: 'conversations',
    Document: 'document',
    Message: 'user_conversation',
    MessageCluster: 'user_conversation',
    AnsweredMessageCluster: 'answered_question',
    UnansweredMessageCluster: 'unanswered_question',
    Note: 'note',
    Notebook: 'notebook',
  }[itemType] || 'document');
};

export const getNotebookItemTypeName = (itemType: string): React.ReactNode | null => {
  return ({
    Contribution: (
      <FormattedMessage
        id="global.endUserContribution"
        defaultMessage="End-user contribution"
        description="Reusable label for End-User Contribution title"
      />
    ),
    Conversation: (
      <FormattedMessage
        id="global.conversation"
        defaultMessage="Conversation"
        description="Reusable label for Conversation page or title"
      />
    ),
    Document: (
      <FormattedMessage
        id="global.sourcedocument"
        defaultMessage="Document"
        description="Label for the Document knowledge source item type"
      />
    ),
    Message: (
      <FormattedMessage
        id="global.message"
        defaultMessage="Message"
        description="Generic label or title for an individual message from a conversation"
      />
    ),
    AnsweredMessageCluster: (
      <FormattedMessage
        id="global.endUserQuestionAnswered"
        defaultMessage="Answered end-user question"
        description="Label for the answered message cluster"
      />
    ),
    UnansweredMessageCluster: (
      <FormattedMessage
        id="global.endUserQuestionUnanswered"
        defaultMessage="Unanswered end-user question"
        description="Label for the unanswered message cluster"
      />
    ),
    Note: (
      <FormattedMessage
        id="global.sourcenote"
        defaultMessage="Editor’s note"
        description="Label for the Note knowledge source item type"
      />
    ),
    Notebook: (
      <FormattedMessage
        id="global.sourcenotebook"
        defaultMessage="Notebook summary"
        description="Label for the Note knowledge source item type"
      />
    ),
  }[itemType] || null);
};

export function getNextSyncTime(): Date {
  const now = new Date();
  const next = new Date(now);
  if (now.getMinutes() < 30) {
    next.setMinutes(30, 0, 0);
  } else {
    next.setHours(now.getHours() + 1, 0, 0, 0);
  }
  return next;
}

export const getPersonalizationIcon = (type: string): string => {
  switch (type) {
    case 'name':
      return 'bot';
    case 'description':
      return 'text_align_left';
    case 'tone':
      return 'waveform';
    case 'languages':
      return 'translate';
    default:
      return 'personalization_source';
  }
};
