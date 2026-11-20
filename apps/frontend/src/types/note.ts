import type { NotebookItem } from "./notebook-item";

export type Note = {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  notebook_id: number;
  notebook_item: NotebookItem;
};
