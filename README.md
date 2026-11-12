# Mission Control

A website version of the **Personal Sprint Work Board** in Notion. Notion stays the only source of truth, and the site reads from it and writes back to it.

## The Signal / Noise system

| Lane | What it holds | Notion `Focus` |
| --- | --- | --- |
| **This is what you should be working on** | The single main task, with Split, Done, Blocked and Idle buttons | `Main` |
| **Task switch** | 3 tasks that are next in line, worked on while Main is idle | `Dashboard` |
| **Today** | 2–6 planned tasks that feed the task switch | `Today` |
| **Working on noise** | A pop-up you chose to work on anyway. It sits beside Main, never in it | `Working on noise` |
| **Noise that came up** | Unplanned pop-ups (`Noise` ticked) and tasks due within 2 days | empty |
| **To-do list** | Everything else | empty |

- Tasks flow upward in `Focus Order`. When Main finishes (Done), gets stuck (Blocked) or goes Idle, the next free Task switch task moves up and Today refills the Task switch.
- **Idle** starts a timer (`Idle Since`) and an optional reminder (`Idle Reminder`). When the task returns to Main, the time is added to `Idle Minutes` and logged in `Idle Log`.
- **Split** breaks a task into sibling tasks, or a project or mission into children. Two ways, picked in the dialog: **Describe it** (say or dictate how you want it split, AI writes the parts, you check them) or **Manual** (list the parts yourself, one per line).
- Levels are Project › Mission › Task, and tasks are grouped by **Departments**.
- **Pop-ups**: the bar at the top takes one line (typed or dictated, `/` jumps to it). `/api/popup` picks the mission and department it belongs to, and the task is added to **Noise that came up**. The plan is not touched.
- Each noise card asks for a decision. **Work on it** moves it to **Working on noise** (Main keeps showing the planned task, with a note that you're on noise). **To signal** adds it to Today; it keeps its `Noise` tick, which is what gives it the yellow pop-up highlight. **To noise** / **Back to noise** takes it out of signal again.
- Notion creates the `Working on noise` option on `Focus` the first time it is used (on the Personal board and on Mission Control Task State).

The flow rules live in `lib/flow.ts` as pure functions. Each action returns the exact Notion edits to make.

## The workday: Sign in / Sign out

- **Start your day** (sign in) opens the **Plan** view with today's recommendations. You build today's ordered plan in any of three ways: tick or drag items in the Department › Project › Mission › Task tree, reorder the plan list, or tell the **Planner** what today is about (typed or by voice). **Start my day** writes the lanes (#1 → Main, the next 3 → Task switch, the rest → Today) and opens today's row in **Mission Control Days**.
- **Sign out** shows the day's numbers: done, Signal vs Noise, planned done, idle time and carried-over tasks. You can add notes, keep unfinished work for tomorrow or send it back to the to-do list, and the stats are saved to the day's row.
- **Which button you see** follows the board, not the log: while anything sits in Main, Task switch, Today or Idle the header shows **End your day**; when all of those are empty it shows **Start your day**. The to-do list and Noise don't count. Work put in a lane without the Start flow opens the day's row on its own.
- **End your day** empties Main, Task switch, Today and Idle (planned work goes back to the to-do list marked as missed, noise you were on goes back to Noise). The to-do list is left alone.
- **Midnight**: a day that wasn't ended gets a silent pop-up at midnight. No answer within 15 minutes and the day is ended for you; **I'm still working** pushes the next check an hour out, and so on until you stop confirming or end the day. If the site was closed at midnight, the day is ended the next time it's opened (logged at 12:15 AM). The confirmation is kept in Neon (`day_overtime`) so every tab and device agrees.
- When a task is marked done it gets `Done At` and `Done As` (Signal if it was in Main, Task switch or Today, pop-ups you sent there included; Noise if it was in a noise lane or the to-do list).
- **Days** charts the last 14 days. **Timeline** is a Gantt of every project and mission, filled by the share of its tasks that are done.

The AI (planner chat, "Recommend me today's tasks", haiku; all in `lib/ai.ts`) calls Claude one of two ways:

- **Your own Anthropic key (preferred):** set `ANTHROPIC_API_KEY`. Calls go straight to Anthropic with the official SDK and are billed to your Anthropic account, where you set spend limits. Model: `ANTHROPIC_MODEL`, default `claude-opus-5-5` ($4 / $20 per million tokens); `claude-sonnet-5-5` is half that.
- **Vercel AI Gateway:** used when there's no Anthropic key. On Vercel it authenticates with the project's OIDC token (enable AI Gateway for the team); locally set `AI_GATEWAY_API_KEY`. Model: `PLANNER_MODEL`, default `anthropic/claude-opus-5.5`. Same list prices as Anthropic.

With neither, everything still works without AI: recommendations rank by priority and due date, the planner matches keywords, and the haiku is a fixed one.

## Company: goals, roadmaps and priority

The **Company** view holds the company master: the legal entities and brands, each project's goal, how we'll know we got there, a rough roadmap (steps and open problems), the team, open questions, and the priority order between projects. We work by position and pivot, so everything is editable, and a change of goal, measure, date, status, priority or roadmap is written to the **pivot log** on its own.

- It lives in Neon (`company_entities`, `company_projects`, `company_roadmap`, `company_pivots`, `company_notes`), created on first use by `lib/company.ts`. Notion stays the source of truth for tasks; Neon is the source of truth for goals and roadmaps.
- The AI planner and "Recommend me today's tasks" read it (`companyForPrompt`): the day should mostly move project #1, and work for lower-ranked projects counts as noise unless it's due, blocking someone, or asked for. A project is matched to its tasks by Notion department name.
- **Private notes** (ownership, money) stay in the database and show only on the site.
- `npm run company:sync` writes the readable copy into every project's local folder: `company/README.md`, `GOAL.md`, `ROADMAP.md`, `TEAM.md`, `PIVOTS.md`, plus a short block in that project's `CLAUDE.md` so its Claude knows the goal and where the project ranks. Mission Control gets `company/PORTFOLIO.md` (git-ignored, because this repo is public) and a block in `AGENTS.md` that carries no company data. Run it after the master changes (`-- --dry` shows what would change). It needs `DATABASE_URL` in `.env.local`.

## How sync works

| Direction | How | Typical delay |
| --- | --- | --- |
| Site → Notion | The edit shows instantly in the browser, is saved to Notion by a server action, and is reverted if the save fails. | Instant on screen, about 1s to save |
| Site → other open tabs | The save expires the shared cache, so every tab's next 2s poll picks it up. | About 2s |
| Notion → site | The Notion webhook expires the shared cache, and every tab's next 2s poll picks it up. | As fast as Notion sends the event, plus up to 2s |
| Fallback | The cache refreshes from Notion every 5s, even if a webhook is missed. | 5 to 7s at most |

- The browser polls `GET /api/board` every 2s. It gets a `304` with no body when nothing changed, and pauses while the tab is hidden.
- `lib/board.ts` puts a shared Vercel cache (`'use cache: remote'`) in front of Notion. Notion only sees about one query every 5s, however many tabs are open, which keeps us under Notion's limit of about 3 requests a second.

## Code map

- `lib/notion.ts`: Notion API calls (query sprints and tasks, update a task) and the property mapping.
- `lib/board.ts`: cached loader for the board (sprints, tasks, department and parent titles).
- `lib/useBoard.ts`: client hook for live polling and optimistic `apply(plan)`.
- `lib/flow.ts`: the Signal / Noise flow engine.
- `components/`: the glass UI (MissionControl, MainCard, TaskCard, QuickAdd, SplitDialog, DetailsDrawer).
- `app/actions.ts`: `updateTask` server action (validates input, writes to Notion, expires the cache) and `login`.
- `app/api/board/route.ts`: board JSON with ETag/304 support.
- `app/api/notion/webhook/route.ts`: Notion webhook (handshake, signature check, cache expiry).
- `proxy.ts` + `lib/auth.ts`: email/password login (from `ADMIN_EMAIL` / `ADMIN_PASSWORD`) protecting every page and API route except `/login` and the webhook.
- `lib/company.ts`, `app/company-actions.ts`, `app/api/company`, `components/CompanyView.tsx`: the company master (goals, roadmaps, pivots) and its editor.
- `scripts/company-sync.mjs`: copies the company master into each project's folder.
- `lib/mock.ts` and `app/api/dev/simulate`: fake board for local development with no Notion token.

## Local development

```bash
npm install
npm run dev
```

With no `NOTION_TOKEN`, the app runs on mock data. To simulate an edit made in Notion:

```bash
curl -X POST localhost:3000/api/dev/simulate -d '{"id":"m3","status":"Under Review"}'
```

To use real data, copy `.env.example` to `.env.local` and fill it in.

## Setup (one time)

1. **Create the Notion integration.** Go to <https://www.notion.so/profile/integrations>, then New integration → Internal. Give it *Read content* and *Update content* capabilities, and copy the secret.
2. **Share the databases with it.** In Notion, open each of these and choose ••• → Connections → add the integration:
   - Personal Sprint Work Board / Personal Ticket Board
   - Sprints
   - Departments (formerly My Projects, so department names show up)
   - Influity Task Board (only tasks assigned to Dani Lev are shown)

   Mission Control's own databases (**Mission Control Days**, the day log, and **Mission Control Task State**, lanes for shared-board tasks) live inside the hidden "Mission Control data" row on the Personal Ticket Board, so they need no extra share.
3. **Set the Vercel environment variables** (Production and Preview):
   ```bash
   vercel env add NOTION_TOKEN
   ```
   ```bash
   vercel env add ADMIN_EMAIL
   ```
   ```bash
   vercel env add ADMIN_PASSWORD
   ```
   Then redeploy. These are the site login. In production the site refuses all access until both are set. Changing the password logs every browser out.
   For the AI planner, make sure AI Gateway is enabled for the Vercel team (Vercel dashboard → AI Gateway).
4. **Turn on instant updates (the webhook).**
   1. In the integration settings, open the Webhooks tab and create a subscription. The URL is `https://<your-domain>/api/notion/webhook`, with page and data source events selected.
   2. Notion sends a verification token to the site. Find it in the Vercel logs by searching for `[notion-webhook] verification_token`, then paste it back into Notion to verify.
   3. Save the same token as `NOTION_WEBHOOK_SECRET`:
      ```bash
      vercel env add NOTION_WEBHOOK_SECRET
      ```
   4. Redeploy.

Notion bundles some events, such as property edits, and may send them a few seconds late. The 5s fallback refresh covers that gap.
