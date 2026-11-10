# Mission Control

A website version of the **Personal Sprint Work Board** in Notion. Notion stays the only source of truth, and the site reads from it and writes back to it.

> **Status:** only the plumbing is built. `app/page.tsx` is a bare debug table that proves the sync works. The real UI comes from the wireframe and should use the `useBoard()` hook.

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
- `lib/board.ts`: cached loader for the board (sprints, tasks, project and parent titles).
- `lib/useBoard.ts`: client hook for live polling and optimistic `edit(task, patch)`. **Build the UI on this.**
- `app/actions.ts`: `updateTask` server action (validates input, writes to Notion, expires the cache) and `login`.
- `app/api/board/route.ts`: board JSON with ETag/304 support.
- `app/api/notion/webhook/route.ts`: Notion webhook (handshake, signature check, cache expiry).
- `proxy.ts`: password gate that protects every page and API route except `/login` and the webhook.
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
   - My Projects (so project names show up)
3. **Set the Vercel environment variables** (Production and Preview):
   ```bash
   vercel env add NOTION_TOKEN
   ```
   ```bash
   vercel env add SITE_PASSWORD
   ```
   Then redeploy. In production, the site refuses all access until `SITE_PASSWORD` is set.
4. **Turn on instant updates (the webhook).**
   1. In the integration settings, open the Webhooks tab and create a subscription. The URL is `https://<your-domain>/api/notion/webhook`, with page and data source events selected.
   2. Notion sends a verification token to the site. Find it in the Vercel logs by searching for `[notion-webhook] verification_token`, then paste it back into Notion to verify.
   3. Save the same token as `NOTION_WEBHOOK_SECRET`:
      ```bash
      vercel env add NOTION_WEBHOOK_SECRET
      ```
   4. Redeploy.

Notion bundles some events, such as property edits, and may send them a few seconds late. The 5s fallback refresh covers that gap.
