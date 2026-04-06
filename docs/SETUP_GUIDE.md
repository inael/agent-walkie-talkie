# Guia de Setup — Agent Walkie-Talkie

Guia completo para integrar dois projetos novos usando o WalkieTalkie.

---

## Pre-requisitos

| Requisito | Versao minima | Como verificar |
|-----------|---------------|----------------|
| Node.js | 18+ | `node -v` |
| Redis | 6+ | `redis-cli ping` → PONG |
| Claude Code CLI | Ultima | `claude --version` |
| Discord Bot Token | — | Ver secao Discord abaixo |

### Redis rapido (Docker)

```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

---

## Passo 1 — Instalar o WalkieTalkie

```bash
git clone https://github.com/inael/agent-walkie-talkie.git
cd agent-walkie-talkie
npm install
npm run build
```

O build gera `dist/` com o MCP Server compilado.

---

## Passo 2 — Configurar variaveis de ambiente

Copie o `.env.example` e preencha:

```bash
cp .env.example .env
```

```env
# Redis — hub central de mensagens
REDIS_URL=redis://localhost:6379

# Discord Bot (ver secao Discord abaixo)
DISCORD_TOKEN=seu-token-aqui
DISCORD_CHANNEL_ID=id-do-canal-aqui

# Web UI
WEB_PORT=3210

# Worker — orquestrador de conversas
CLAUDE_CLI_PATH=claude                # ou caminho completo: C:/Users/.../claude.cmd
MAX_CONCURRENT_CONVERSATIONS=3        # conversas simultaneas
DEFAULT_MAX_ROUNDS=10                 # rounds antes de forcar encerramento
ROUND_TIMEOUT_MS=300000               # 5 minutos por round
```

> **Windows**: use o caminho completo do CLI:
> `CLAUDE_CLI_PATH=C:/Users/SEU_USER/AppData/Roaming/npm/claude.cmd`

---

## Passo 3 — Registrar MCP em cada projeto

Cada projeto que participara precisa registrar o MCP Server no seu `.claude/settings.json`.

### Projeto A

Crie ou edite `<PROJETO_A>/.claude/settings.json`:

```json
{
  "mcpServers": {
    "walkie-talkie": {
      "command": "node",
      "args": ["/caminho/para/agent-walkie-talkie/dist/mcp-server/index.js"],
      "env": {
        "WT_PROJECT_ID": "projeto-a",
        "WT_PROJECT_PATH": "/caminho/para/projeto-a",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Projeto B

Mesma estrutura, trocando ID e path:

```json
{
  "mcpServers": {
    "walkie-talkie": {
      "command": "node",
      "args": ["/caminho/para/agent-walkie-talkie/dist/mcp-server/index.js"],
      "env": {
        "WT_PROJECT_ID": "projeto-b",
        "WT_PROJECT_PATH": "/caminho/para/projeto-b",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Regras para WT_PROJECT_ID

- Usar lowercase, sem espacos: `meu-projeto`, `freelanceia`, `itbooster`
- Deve ser unico por projeto
- E o identificador usado em `wt_start(to: "projeto-b")`

### Regras para WT_PROJECT_PATH

- Caminho absoluto para a raiz do projeto
- O Worker usa esse path para spawnar `claude -p` no diretorio correto
- Windows: use barras normais `/` (Node.js aceita)

---

## Passo 4 — Subir os servicos

### Opcao A: Tudo junto

```bash
cd agent-walkie-talkie
npm run start
```

Sobe Worker + Discord Bot + Web UI simultaneamente.

### Opcao B: Separado (recomendado para debug)

```bash
# Terminal 1 — Orquestrador
npm run worker

# Terminal 2 — Discord Bot
npm run discord

# Terminal 3 — Web UI
npm run web
```

### Opcao C: Docker Compose

```bash
docker compose up -d
```

---

## Passo 5 — Primeiro teste

### 5.1 Na sessao Claude Code do Projeto A

Diga ao Claude:

> "Registre este projeto no walkie-talkie e inicie uma conversa com projeto-b sobre integrar a API de pagamentos"

O Claude vai executar:

```
wt_register(description: "Sistema de pagamentos")
wt_start(to: "projeto-b", subject: "Integrar API de pagamentos", context: "Precisamos de um endpoint POST /payments que aceite...")
```

### 5.2 O que acontece automaticamente

1. Worker detecta a mensagem no Redis Stream do projeto-b
2. Worker spawna `claude -p` no diretorio do projeto-b
3. O Claude do projeto-b le a mensagem e responde
4. A resposta volta pelo Redis Stream para o projeto-a
5. Worker spawna `claude -p` no projeto-a para continuar
6. Repete ate acordo ou limite de rounds

### 5.3 Monitoramento

- **Discord**: thread criada automaticamente no canal configurado
- **Web UI**: acesse `http://localhost:3210`

---

## Passo 6 — Validacao

Checklist de que tudo funciona:

- [ ] `redis-cli ping` retorna PONG
- [ ] `npm run build` sem erros
- [ ] Worker inicia sem erros no log
- [ ] Discord bot aparece online no servidor
- [ ] Web UI acessivel em localhost:3210
- [ ] Projeto A consegue usar `wt_register` (MCP carregado)
- [ ] Projeto B consegue usar `wt_register` (MCP carregado)
- [ ] `wt_start` cria thread no Discord
- [ ] Conversa avanca pelo menos 2 rounds automaticamente

---

## Troubleshooting

| Problema | Causa provavel | Solucao |
|----------|---------------|---------|
| MCP tools nao aparecem no Claude Code | `.claude/settings.json` mal formatado ou path errado | Verificar JSON e path do `index.js` |
| Worker nao detecta mensagens | Redis nao esta rodando | `redis-cli ping` |
| Discord bot nao posta | Token ou Channel ID errado | Verificar `.env` |
| `claude -p` falha no Worker | `CLAUDE_CLI_PATH` errado | Testar manualmente: `claude -p "teste"` |
| Conversa trava no round 1 | Projeto B nao esta registrado | Registrar com `wt_register` antes |
| Timeout em todos os rounds | `ROUND_TIMEOUT_MS` muito baixo | Aumentar para 600000 (10min) |

---

## Exemplo real: ITBooster + FreelanceIA

Veja o contrato gerado automaticamente em:
[contracts/freelanceia-itbooster.md](../contracts/freelanceia-itbooster.md)

Esse contrato foi gerado apos 4 rounds de conversa autonoma entre os agentes.
