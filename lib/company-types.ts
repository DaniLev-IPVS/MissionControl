// The company master: who we are, each project's goal, and the rough roadmap to it.
// Everything is editable (position, then pivot); every change of direction is logged as a pivot.

export const PROJECT_STATUSES = ["active", "side", "paused", "folded"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Active",
  side: "Side project",
  paused: "Paused",
  folded: "Folded in",
};

export const ROADMAP_STATUSES = ["planned", "active", "done", "dropped"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];
export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  planned: "Planned",
  active: "Now",
  done: "Done",
  dropped: "Dropped",
};

export const ROADMAP_KINDS = ["step", "problem"] as const;
export type RoadmapKind = (typeof ROADMAP_KINDS)[number];

export type Entity = {
  slug: string;
  name: string;
  kind: string; // company | brand
  jurisdiction: string | null;
  parentSlug: string | null;
  relationship: string | null; // how it relates to the parent, in words
  status: string; // active | discontinued
  summary: string;
  privateNotes: string; // never leaves Mission Control
  position: number;
};

export type TeamMember = { name: string; role: string };
export type ProjectLink = { label: string; url: string };

export type RoadmapItem = {
  id: number;
  projectSlug: string;
  position: number;
  kind: RoadmapKind; // a step on the road, or an open problem to solve
  title: string;
  detail: string;
  status: RoadmapStatus;
};

export type Pivot = {
  id: number;
  createdAt: string;
  projectSlug: string | null; // null = company-wide
  summary: string;
  why: string;
};

export type Project = {
  slug: string;
  name: string;
  entitySlug: string | null;
  rank: number; // 1 = the main project; wins when projects compete for time
  status: ProjectStatus;
  oneLiner: string;
  goal: string;
  successMetric: string;
  targetDate: string | null; // YYYY-MM-DD
  context: string; // how it works, in plain words (shared with the project's folder)
  team: TeamMember[];
  openQuestions: string[];
  departments: string[]; // Notion department names whose tasks belong to this project
  localFolder: string | null; // folder name inside "IP VENTURES CODE"
  repo: string | null;
  links: ProjectLink[];
  privateNotes: string; // never leaves Mission Control
  updatedAt: string;
  roadmap: RoadmapItem[];
};

export type Company = {
  configured: boolean; // false = no database connected here
  notes: Record<string, string>; // company_goal, how_we_work, ...
  entities: Entity[];
  projects: Project[];
  pivots: Pivot[];
};

export type ProjectPatch = Partial<
  Pick<
    Project,
    | "name" | "status" | "oneLiner" | "goal" | "successMetric" | "targetDate" | "context" | "team" | "openQuestions"
    | "departments" | "privateNotes"
  >
>;
export type RoadmapPatch = Partial<Pick<RoadmapItem, "title" | "detail" | "status" | "kind">>;
