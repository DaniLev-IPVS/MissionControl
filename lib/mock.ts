import "server-only";
import type { Sprint, Task, TaskPatch } from "./types";

// Fake data for local development without a Notion token.
type Store = { sprints: Sprint[]; tasks: Task[]; titles: Record<string, string> };

const g = globalThis as unknown as { __mockStore?: Store };

function today(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function seed(): Store {
  const now = new Date().toISOString();
  const t = (id: string, name: string, s: string, extra: Partial<Task> = {}): Task => ({
    id, url: "https://www.notion.so", name, status: s, priority: "P1", level: "task",
    due: null, projectIds: ["proj-a"], parentId: "parent-1", hasChildren: false, editedAt: now, ...extra,
  });
  return {
    sprints: [
      { id: "sprint-2", name: "Sprint 2", status: "Current", start: today(-8), end: today(5) },
      { id: "sprint-3", name: "Sprint 3", status: "Next", start: null, end: null },
      { id: "sprint-1", name: "Sprint 1", status: "Last", start: today(-22), end: today(-9) },
    ],
    titles: { "proj-a": "Studio Ops", "proj-b": "Client Work", "parent-1": "Launch checkpoint", "parent-2": "Finance setup" },
    tasks: [
      t("parent-1", "Launch checkpoint", "Working on it", { level: "mission", hasChildren: true, parentId: null }),
      t("m1", "Draft the pitch deck", "Working on it", { priority: "P0", due: today(-2) }),
      t("m2", "Review the new logo files", "To Start", { due: today(1) }),
      t("m3", "Call the lead list", "To Start", { projectIds: ["proj-b"], parentId: "parent-2", due: today(2) }),
      t("m4", "Wait on bank approval", "Blocked", { priority: "P0", projectIds: ["proj-b"], parentId: "parent-2" }),
      t("m5", "Set up accounting export", "Done", { priority: "P2", parentId: "parent-2", projectIds: ["proj-b"] }),
      t("m6", "Plan next video batch", "Groom", { priority: null }),
    ],
  };
}

export function mockStore(): Store {
  g.__mockStore ??= seed();
  return g.__mockStore;
}

export function mockUpdate(id: string, patch: TaskPatch) {
  const task = mockStore().tasks.find((t) => t.id === id);
  if (!task) throw new Error("Task not found");
  Object.assign(task, patch, { editedAt: new Date().toISOString() });
}
