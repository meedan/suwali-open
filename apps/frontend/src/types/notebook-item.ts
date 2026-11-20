import type { Contribution } from "./contribution";
import type { Conversation } from "./conversation";
import type { Document } from "./document";
import type { Message } from "./message";
import type { PartialMessageCluster } from "./message-cluster";
import type { Note } from "./note";
import type { Notebook } from "./notebook";

export type NotebookItemTypes = 'Contribution' | 'Conversation' | 'Document' | 'Message' | 'Notebook' | 'MessageCluster' | 'Note';

export type NotebookContribution = {
  id: number;
  item: Contribution;
  item_id: number;
  item_type:  'Contribution';
  notebook_id: number;
  updated_at: string;
};

export type NotebookConversation = {
  id: number;
  item: Conversation;
  item_id: number;
  item_type:  'Conversation';
  notebook_id: number;
  updated_at: string;
};

export type NotebookDocument = {
  id: number;
  item: Document;
  item_id: number;
  item_type:  'Document';
  notebook_id: number;
  updated_at: string;
};

export type NotebookMessage = {
  id: number;
  item: Message;
  item_id: number;
  item_type:  'Message';
  notebook_id: number;
  updated_at: string;
};

export type NotebookMessageCluster = {
  id: number;
  item: PartialMessageCluster;
  item_id: number;
  item_type:  'MessageCluster';
  notebook_id: number;
  updated_at: string;
};

export type NotebookNote = {
  id: number;
  item: Note;
  item_id: number;
  item_type:  'Note';
  notebook_id: number;
  updated_at: string;
};

export type NotebookNotebook = {
  id: number;
  item: Notebook;
  item_id: number;
  item_type:  'Notebook';
  notebook_id: number;
  updated_at: string;
};

export type NotebookItem = NotebookConversation | NotebookContribution | NotebookDocument | NotebookMessage | NotebookMessageCluster | NotebookNote | NotebookNotebook;
