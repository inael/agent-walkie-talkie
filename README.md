# agent-walkie-talkie

**MCP Server for autonomous agent-to-agent communication between Claude Code instances.**

> Your AI agents talk. You watch on Discord. With popcorn.

---

## The Problem (a.k.a. "The Copy-Paste Hell")

You're building two projects. Project A needs to integrate with Project B. Sounds simple, right?

Here's what actually happens:

1. You open **Project A** in Claude Code: *"Hey Claude, I need an API endpoint that sends project data to Project B"*
2. Claude A writes a beautiful API spec
3. You **copy** the output. All of it. With your mouse. Like it's 2005.
4. You switch to **Project B**: *"Hey Claude, here's what Project A expects from you..."*
5. You **paste** the wall of text. Claude B reads it. Asks questions.
6. You copy Claude B's questions. Switch back to Project A. Paste. Wait. Copy the answer. Switch. Paste.
7. Repeat **47 times** until both sides agree on a JSON schema.
8. You mass the wrong tab. Lose context. Start over.

By the end, **you** are the bottleneck. **You** are the human message bus. **You** are the walkie-talkie.

**What if your agents could just... talk to each other?**

---

## The Solution

**agent-walkie-talkie** is an MCP Server that lets Claude Code instances communicate autonomously through Redis Streams. You start a conversation, they figure it out, you watch the whole thing on Discord (or a web UI) while sipping coffee.

```
Project A (Claude Code)              Project B (Claude Code)
  "Hey, I need POST /webhook         "Got it. But I need auth.
   with these fields..."               How about X-API-Key header?"
        │                                     │
        └──────► Redis Streams ◄──────────────┘
                      │
                 WalkieTalkie Worker
                 (spawns claude -p for each side)
                      │
              ┌───────┴───────┐
          Discord 🎯       Web UI 🖥️
          #walkie-talkie   localhost:3210
          (thread per       (chat interface
           conversation)     with controls)
```

### How it works

1. **Register** your projects as participants
2. **Start a conversation** with a subject and context
3. The **Worker** daemon listens on Redis, spawns `claude -p` for each side
4. Agents exchange messages autonomously (with configurable round limits)
5. **You watch** on Discord (threads) or Web UI (real-time chat)
6. **Intervene** anytime: pause, inject a message, add more rounds
7. When they agree, a **CONTRACT.md** is generated with the integration spec

### Your controls

| Action | Discord | Web UI |
|--------|---------|--------|
| Watch conversation | Thread auto-updates | Real-time WebSocket |
| Pause | React with ⛔ | Click [Pause] |
| Intervene as CEO | React with 💬 | Type in chat |
| Add more rounds | React with ➕ | Click [+5 rounds] |
| Approve agreement | React with ✅ | Click [Approve] |

---

## Documentation

| Doc | Description |
|-----|-------------|
| **[Setup Guide](docs/SETUP_GUIDE.md)** | Step-by-step guide to integrate two new projects |
| **[Discord Bot Setup](docs/DISCORD_BOT_SETUP.md)** | How to create, configure, and use the Discord bot |
| **[MCP Tools Reference](docs/MCP_TOOLS_REFERENCE.md)** | Complete reference for all 7 MCP tools |
| **[Example Contract](contracts/freelanceia-itbooster.md)** | Real contract auto-generated from a 4-round conversation |

---

## Quick Start

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) with active subscription
- Redis running locally (port 6379)
- Discord bot token (for Discord integration — see [Discord Bot Setup](docs/DISCORD_BOT_SETUP.md))

### Install

```bash
git clone https://github.com/inael/agent-walkie-talkie.git
cd agent-walkie-talkie
npm install
npm run build
```

### Register in your projects

Add to each project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "walkie-talkie": {
      "command": "node",
      "args": ["/path/to/agent-walkie-talkie/dist/mcp-server/index.js"],
      "env": {
        "WT_PROJECT_ID": "my-project",
        "WT_PROJECT_PATH": "/path/to/my-project",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

> For the full setup walkthrough with troubleshooting, see **[Setup Guide](docs/SETUP_GUIDE.md)**.

### Start the services

```bash
# All services together (worker + discord + web)
npm run start

# Or with Docker
docker compose up -d

# Or individually for debugging
npm run worker    # orchestrator daemon
npm run discord   # discord bot
npm run web       # web UI at localhost:3210
```

### Start a conversation

In Claude Code (Project A):
```
> "Start a walkie-talkie conversation with project-b about the API integration"
```

Claude will use the MCP tools:
```
wt_register(description: "My project")
wt_start(to: "project-b", subject: "API Integration", max_rounds: 10)
```

Then sit back and watch on Discord.

> For the complete tool reference, see **[MCP Tools Reference](docs/MCP_TOOLS_REFERENCE.md)**.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `wt_register` | Register this project as a participant |
| `wt_start` | Start a conversation (to, subject, context, max_rounds) |
| `wt_send` | Send a message in a conversation |
| `wt_read` | Read pending messages |
| `wt_list` | List active conversations |
| `wt_status` | Pending messages, rounds remaining |
| `wt_end` | End conversation (agreement / blocked / delivered) |

---

## Guardrails

Because autonomous AI conversations need boundaries:

| Guardrail | Default | Configurable |
|-----------|---------|-------------|
| Max rounds per conversation | 10 | Yes |
| Timeout per round | 5 min | Yes |
| Message types that end conversation | `agreement`, `blocked`, `delivered` | Yes |
| Max concurrent conversations | 3 | Yes |
| CEO notification on end | Discord | Yes |

---

## Architecture

```
agent-walkie-talkie/
├── src/
│   ├── mcp-server/          # MCP Server (installed per project)
│   │   ├── index.ts
│   │   └── tools/           # wt_send, wt_read, wt_start, etc.
│   ├── worker/              # Daemon (listens Redis, spawns Claude)
│   │   ├── index.ts
│   │   ├── guardrails.ts
│   │   └── claude-runner.ts
│   ├── discord-bot/         # Standalone bot, reusable
│   │   ├── index.ts
│   │   └── handlers/
│   └── web/                 # Simple chat UI
│       ├── server.ts
│       └── public/
├── contracts/               # Generated contracts
├── docker-compose.yml
└── package.json
```

---

## Use Cases

- **Two projects that need to integrate** — agents negotiate the API contract
- **Microservices design** — agents from each service agree on interfaces
- **Frontend + Backend split** — agents coordinate data shapes and endpoints
- **Multi-repo monolith migration** — agents plan the extraction together
- **Client + Vendor projects** — agents from different orgs collaborate

---

## Roadmap

- [x] Core concept & architecture
- [x] MCP Server with 7 tools
- [x] Redis Streams communication
- [x] Worker daemon with claude -p
- [x] Discord bot (standalone, threads + reactions)
- [x] Web UI (real-time WebSocket chat)
- [x] CONTRACT.md auto-generation
- [x] Full documentation (setup, discord, tools reference)
- [ ] npm package for easy installation
- [ ] Multi-model support (not just Claude)
- [ ] Conversation templates (API design, migration, etc.)
- [ ] Persistent conversation history (survive Redis restart)
- [ ] Webhook notifications (beyond Discord)

---

## Contributing

PRs welcome! This project is in early development. Check the [issues](https://github.com/inael/agent-walkie-talkie/issues) for what's being worked on.

---

## License

MIT - do whatever you want, just keep the copyright.

---

<p align="center">
  <i>Stop being the human message bus. Let your agents talk.</i>
  <br><br>
  Built with frustration and coffee by <a href="https://github.com/inael">@inael</a> at <a href="https://itbooster.com.br">IT Booster Global</a>
</p>
