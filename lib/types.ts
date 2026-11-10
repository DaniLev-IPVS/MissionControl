export type Task = {
  id: string;
  url: string;
  name: string;
  status: string | null;
  priority: string | null;
  level: string | null;
  due: string | null;
  projectIds: string[];
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
  titles: Record<string, string>; // project + parent page titles by id
  fetchedAt: string;
};

export type TaskPatch = {
  status?: string;
  priority?: string | null;
  due?: string | null;
};
