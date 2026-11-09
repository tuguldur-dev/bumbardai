# Hallway Quest

Turn every conference into an adventure. Hallway Quest helps first-time KubeCon attendees plan their day, prepare for sessions, and take small steps toward meeting people.

## Run locally

Requires Docker with Compose. From the repository root:

```sh
cp .env.example .env
docker compose up --build -d
```

Open [Hallway Quest](http://localhost:3000/). The migration and catalog services run once. PostgreSQL and Elasticsearch stay on the private Compose network. To see their startup and the import result:

```sh
docker compose ps -a
docker compose logs migrate catalog
```

Set `OPENAI_API_KEY` in `.env` and recreate the app to enable model-written briefings, quests, icebreakers, and live catalog embeddings. The app labels rules-based guidance and keyword-only search when the providers are unavailable. The guided demo uses topic fixtures for vector search when the key is absent. A fresh live catalog search can take longer while the index is populated.

### Use local Ollama

Start Ollama and use `ollama list` to find a downloaded chat model. For example, with `gemma4:e4b` installed, set these values in `.env`:

```dotenv
AI_PROVIDER=ollama
OLLAMA_MODEL=gemma4:e4b
```

Recreate the app with `docker compose up --build -d app`. Docker Desktop defaults to `http://host.docker.internal:11434` and native development defaults to `http://127.0.0.1:11434`. Set `OLLAMA_BASE_URL` if your API process needs a different address. The assistant uses rules-based guidance if the model is unavailable or its reply fails validation. Search embeddings are configured separately through OpenAI.

Refresh the official schedule with `docker compose run --rm catalog`. The importer checks the Salt Lake City edition and preserves the last successful catalog on fetch or validation failure. The official Cloud Native Hackathon is a date-only entry. Set your confirmed start and end in Schedule to get timed reminders. [Conference schedule](https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/) · [Hackathon organizer](https://www.wemakedevs.org/hackathons/cnh)

Run `docker compose down` to stop the stack and retain its data. To test on a phone, put the phone and laptop on the same network and reverse-proxy the loopback app over HTTPS. For example, on the Docker host with Caddy installed, replace `192.168.1.12` with its LAN address:

```caddyfile
https://192.168.1.12 {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

Save this as a local Caddyfile and run `caddy run --config /path/to/Caddyfile`.

Set `PUBLIC_ORIGIN=https://192.168.1.12` in `.env`, recreate the app, and trust the local Caddy CA on the phone before visiting that URL. HTTPS enables the service worker and camera on a separate device. Installability and Web Push depend on the browser and platform. To enable basic browser push, generate a VAPID key pair with `pnpm --filter @hallway/api exec web-push generate-vapid-keys`, configure the three VAPID variables in `.env`, recreate the app and reminder worker, and opt in from Profile. In-app reminders work independently of push. Set an OTLP endpoint to export API and reminder spans.

## Deploy to Kubernetes

Use the [Flux deployment guide](deploy/README.md) for persistent storage, database migrations, the app, and optional Ollama and HTTPS configuration.

## Hackathon walkthrough

1. Register with **Use the guided demo with sample data** checked. Enter a nickname, choose Kubernetes and Go, select a comfortable networking level, and finish onboarding. Replay uses Tuesday, November 10, 2026 at 10:45 a.m. Mountain Time, with simulated weather, sessions, and attendees.
2. In **Schedule**, add a hackathon at The Shop Workspace from 11:15 a.m. to 12:30 p.m. On **Today**, find the warm-layer guidance and the laptop and charger checklist. Opt into reminders in **Profile**, then open the bell.
3. In **Explore**, search for “beginner Go.” Open a result and save it to the calendar. Explore’s People tab shows demo matches if you opt in. Use a second account to test accepting a real introduction.
4. Back on **Today**, tap **What should I do next?** to get a small quest that fits before the hackathon. Start it, ask for a new icebreaker, then complete it for XP and **First Hello**. To try mutual confirmation, start another quest, show its QR code, and verify it using a different demo account.
5. Open **Profile** on a second browser with the same account to see the progress. On a browser that has loaded the app online, switch to offline to see the read-only cached schedule and active quests.

## Connect a local MCP client

From **Profile**, issue a client credential. Read-only credentials can fetch a briefing, search, recommend activities, and preview a quest. Enable quest completion when issuing a credential if the client needs to award XP. Schedule creation has its own permission. Credentials expire after 30 days and can be revoked in Profile.

Install workspace dependencies with Node.js 24 and pnpm 11.25.0. Configure a local stdio client with the following command and environment. Keep the token in the client’s secret settings or the environment.

```json
{
  "mcpServers": {
    "hallway-quest": {
      "command": "node",
      "args": ["--import", "/absolute/path/to/bumbardai/apps/mcp/node_modules/tsx/dist/loader.mjs", "/absolute/path/to/bumbardai/apps/mcp/src/index.ts"],
      "env": {
        "HALLWAY_API_URL": "http://127.0.0.1:3000",
        "HALLWAY_MCP_TOKEN": "<credential from Profile>"
      }
    }
  }
}
```

Alternatively set the client working directory to `apps/mcp` and use `node --import tsx src/index.ts`. Ask “I have 15 minutes. What should I do next?” The client can call `get_next_event` with `includeRecommendation: true`, then use `get_active_quests` or `recommend_sessions` for more context. The app exposes the 14 tool contracts through the stdio server.

## Connect Gemini Apps

Deploy Hallway Quest over public HTTPS and set `PUBLIC_ORIGIN` to that origin. In **Profile → Connect an AI client**, create a credential and copy its client ID and secret. Enable schedule creation if Gemini should be able to add events.

In Gemini web, open **Settings → Connected Apps → Add a custom app**. Enter the public Hallway Quest URL ending in `/mcp`. Under **Advanced features**, enter the OAuth client ID and secret. Sign in to Hallway Quest in the same browser and approve access. If prompted to sign in during linking, sign in and retry the connection. The credential expires after 30 days. Revoke it from Profile to disconnect access immediately.

Select the connected Hallway Quest app in Gemini, then type or dictate a request such as “Add a meeting with Alex tomorrow from 1 to 2 p.m. Mountain Time.” Gemini asks for approval before running write tools. An overlapping event is returned as a conflict and stays unsaved. See [Google’s Gemini Apps setup guide](https://support.google.com/gemini/answer/17209137).

## Develop and verify

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm format:check
pnpm test
pnpm --filter @hallway/web exec playwright install chromium
EXPECT_HYBRID=1 pnpm --filter @hallway/web test
pnpm --filter @hallway/mcp exec node --import tsx src/smoke.ts
```

Browser and MCP smoke tests require a running test instance. Use `HALLWAY_APP_URL` or `HALLWAY_API_URL` for a non-default address. Run database integration tests against a **disposable** migrated PostgreSQL database by setting `TEST_DATABASE=1`, `DATABASE_URL`, and optionally `ELASTICSEARCH_URL`. Leave `OPENAI_API_KEY` empty for repeatable fixture tests. To develop against independently running services, set these URLs in the environment and run `pnpm dev`. Vite proxies `/api` to port 3000.

The React/Vite frontend and Fastify API organize domain code under `src/features`. The web app uses shadcn/ui for controls, ahooks `useRequest` for HTTP state, and shared Zod schemas to validate API responses and infer TypeScript types. Run `pnpm format` to apply the workspace style. PostgreSQL owns schedules, consent, and awards. Elasticsearch indexes sessions and opted-in attendees for retrieval.
