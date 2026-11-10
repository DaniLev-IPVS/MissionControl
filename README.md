# Mission Control

A website version of the **Personal Sprint Work Board** in Notion. Notion stays the only source of truth, and the site reads from it and writes back to it.

## The Signal / Noise system

| Lane | What it holds | Notion `Focus` |
| --- | --- | --- |
| **Currently working on** | The single main task, with Split, Done, Blocked and Idle buttons | `Main` |
| **Task switch** | 3 tasks that are next in line, worked on while Main is idle | `Dashboard` |
| **Today** | 2–6 planned tasks that feed the task switch | `Today` |
| **Noise** | Unplanned pop-ups (`Noise` ticked) and tasks due within 2 days | empty |
| **To-do list** | Everything else | empty |

- Tasks flow upward in `Focus Order`. When Main finishes (Done), gets stuck (Blocked) or goes Idle, the next free Task switch task moves up and Today refills the Task switch.
- **Idle** starts a timer (`Idle Since`) and an optional reminder (`Idle Reminder`). When the task returns to Main, the time is added to `Idle Minutes` and logged in `Idle Log`.
- **Split** breaks a task into sibling tasks, or a project or mission into children.
- Levels are Project › Mission › Task, and tasks are grouped by **Departments**.

The flow rules live in `lib/flow.ts` as pure functions. Each action returns the exact Notion edits to make.

## The workday: Sign in / Sign out

- **Sign in** opens the **Plan** view. You build today's ordered plan in any of three ways: tick or drag items in the Department › Project › Mission › Task tree, reorder the plan list, or tell the **Planner** what today is about (typed or by voice). **Start my day** writes the lanes (#1 → Main, the next 3 → Task switch, the rest → Today) and opens today's row in **Mission Control Days**.
- **Sign out** shows the day's numbers: done, Signal vs Noise, planned done, idle time and carried-over tasks. You can add notes, keep unfinished work for tomorrow or send it back to the to-do list, and the stats are saved to the day's row.
- When a task is marked done it gets `Done At` and `Done As` (Signal if it was planned and not a pop-up, otherwise Noise).
- **Days** charts the last 14 days. **Timeline** is a Gantt of every project and mission, filled by the share of its tasks that are done.

The AI planner (`app/api/plan`) calls Claude through **Vercel AI Gateway** (`PLANNER_MODEL`, default `anthropic/claude-sonnet-5.5`). On Vercel it authenticates with the project's OIDC token. Locally, set `AI_GATEWAY_API_KEY`; without it the planner falls back to keyword matching.

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
   - The **Mission Control** page, which holds the Mission Control Days database (the day log)
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
