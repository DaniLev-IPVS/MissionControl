import type { Level } from "./config";

export type Task = {
  id: string;
  url: string;
  name: string;
  status: string | null;
  priority: string | null;
  level: Level | null; // project > mission > task (Notion: Mission > Checkpoint > Bite)
  due: string | null;
  departmentIds: string[]; // Notion "Departments" relation
  parentId: string | null;
  hasChildren: boolean;
  editedAt: string;
};

export type Sprint = {
  id: string;
  name: string;
  status: string | null;
  start: string | null;
  end: string | null;
};

export type Board = {
  sprint: Sprint | null;
  sprints: Sprint[];
  tasks: Task[];
  titles: Record<string, string>; // department + parent page titles by id
  fetchedAt: string;
};

export type TaskPatch = {
  status?: string;
  priority?: string | null;
  due?: string | null;
};
