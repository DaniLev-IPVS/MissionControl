<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:company -->
## Company context

Mission Control holds the company master: legal entities, each project's goal and rough roadmap, the priority order between projects, and the pivot log. It lives in Neon (tables `company_*`, code in `lib/company.ts`), is edited in the site's Company view, and feeds the AI planner so it can tell signal from noise across projects.

Read `company/PORTFOLIO.md` for the current goals, roadmaps and priority order before planning or recommending work. It is generated and git-ignored (this repo is public): if it's missing or stale, run `npm run company:sync`, which also refreshes every project folder's `company/` files and CLAUDE.md block. Never write company data (goals, numbers, names, ownership) into a tracked file here.
<!-- END:company -->
