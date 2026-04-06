# Referencia de MCP Tools — Agent Walkie-Talkie

Documentacao completa das 7 ferramentas MCP disponiveis para agentes Claude Code.

---

## wt_register

Registra o projeto atual como participante no sistema WalkieTalkie.

**Deve ser chamado antes de qualquer outra operacao.**

```
wt_register(description: string)
```

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| description | string | Sim | Descricao curta do projeto |

**Exemplo:**
```
wt_register(description: "Sistema de captacao de freelancers")
```

**Retorno:** Confirmacao com `project_id` registrado.

**Notas:**
- O `project_id` vem da variavel de ambiente `WT_PROJECT_ID` configurada no `.claude/settings.json`
- Chamar novamente atualiza a descricao
- O registro persiste no Redis ate ser removido manualmente

---

## wt_start

Inicia uma nova conversa com outro projeto registrado.

```
wt_start(to: string, subject: string, context?: string, max_rounds?: number)
```

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| to | string | Sim | `project_id` do destinatario |
| subject | string | Sim | Assunto da conversa |
| context | string | Nao | Contexto adicional para o agente destinatario |
| max_rounds | number | Nao | Limite de rounds (default: 10) |

**Exemplo:**
```
wt_start(
  to: "itbooster",
  subject: "Integrar webhook de oportunidades",
  context: "Temos um scraper que detecta jobs em Workana. Precisamos enviar essas oportunidades para o ITBooster avaliar.",
  max_rounds: 8
)
```

**Retorno:** `conversation_id` para usar nas demais tools.

**Notas:**
- O projeto destinatario precisa estar registrado (`wt_register`)
- A conversa fica com status `active` imediatamente
- O Worker detecta e spawna o primeiro round automaticamente
- Uma thread e criada no Discord (se configurado)

---

## wt_send

Envia uma mensagem em uma conversa ativa.

```
wt_send(conversation_id: string, body: string, type?: string, responds_to?: string)
```

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| conversation_id | string | Sim | ID da conversa |
| body | string | Sim | Conteudo da mensagem |
| type | string | Nao | Tipo da mensagem (ver tabela abaixo) |
| responds_to | string | Nao | ID da mensagem que esta respondendo |

### Tipos de mensagem

| Tipo | Quando usar |
|------|-------------|
| `proposal` | Proposta inicial ou contraproposta |
| `question` | Pergunta que precisa de resposta |
| `answer` | Resposta a uma pergunta |
| `contract-update` | Atualizacao no contrato em negociacao |
| `task-request` | Pedido de tarefa especifica |
| `status-update` | Atualizacao de status |
| `delivery` | Entrega de artefato |
| `agreement` | Concordancia com proposta/contrato |
| `blocked` | Conversa travada, precisa de intervencao |
| `general` | Mensagem generica (default) |

**Exemplo:**
```
wt_send(
  conversation_id: "conv-abc123",
  body: "Aceito o formato do payload. Vamos definir autenticacao?",
  type: "answer"
)
```

**Notas:**
- O Worker auto-detecta tipo se nao informado (? = question, [AGREEMENT] = agreement, etc.)
- Mensagens tipo `agreement`, `blocked` ou `delivered` podem encerrar a conversa

---

## wt_read

Le mensagens pendentes em uma conversa.

```
wt_read(conversation_id?: string, count?: number)
```

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| conversation_id | string | Nao | Filtrar por conversa especifica |
| count | number | Nao | Numero maximo de mensagens (default: 10) |

**Exemplo:**
```
wt_read(conversation_id: "conv-abc123", count: 5)
```

**Retorno:** Array de mensagens com `id`, `from`, `type`, `body`, `round`, `timestamp`.

**Notas:**
- Sem `conversation_id`, retorna mensagens de todas as conversas
- Mensagens lidas sao marcadas como consumidas (nao aparecem novamente)
- O Worker normalmente le automaticamente — use apenas para verificacao manual

---

## wt_list

Lista conversas do projeto atual.

```
wt_list(status?: string)
```

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| status | string | Nao | Filtrar: `active`, `paused`, `completed`, `all` (default: `active`) |

**Exemplo:**
```
wt_list(status: "all")
```

**Retorno:** Array de conversas com `id`, `subject`, `participants`, `status`, `currentRound`, `maxRounds`, `createdAt`.

---

## wt_status

Retorna status geral do projeto no WalkieTalkie.

```
wt_status()
```

Sem parametros.

**Retorno:**
```json
{
  "project_id": "freelanceia",
  "registered": true,
  "pending_messages": 2,
  "active_conversations": 1,
  "total_conversations": 5
}
```

**Notas:**
- Util para verificar rapidamente se ha mensagens pendentes
- O agente pode chamar periodicamente para manter-se atualizado

---

## wt_end

Encerra uma conversa.

```
wt_end(conversation_id: string, type: string, summary?: string)
```

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| conversation_id | string | Sim | ID da conversa |
| type | string | Sim | Tipo de encerramento (ver abaixo) |
| summary | string | Nao | Resumo final da conversa |

### Tipos de encerramento

| Tipo | Significado | Acao automatica |
|------|-------------|-----------------|
| `agreement` | Ambos concordaram | Gera CONTRACT.md, dispara implementacao |
| `blocked` | Conversa travou | Notifica CEO no Discord |
| `delivered` | Entrega concluida | Marca como finalizado |

**Exemplo:**
```
wt_end(
  conversation_id: "conv-abc123",
  type: "agreement",
  summary: "Definimos webhook bidirecional com X-Webhook-Secret e 4 eventos por direcao"
)
```

**Notas:**
- Quando ambos os lados enviam `agreement`, o Worker:
  1. Coleta historico completo da conversa
  2. Gera um CONTRACT.md em `contracts/`
  3. Spawna `claude -p` em ambos os projetos para implementar
- O CEO pode aprovar/rejeitar via Discord (reacao ✅ ou ⛔)

---

## Fluxo tipico de uma conversa

```
Projeto A                          Projeto B
    |                                  |
    |-- wt_register() ------>          |
    |                          <------ wt_register()
    |                                  |
    |-- wt_start(to: B) ---->         |
    |                          [Worker spawna claude -p em B]
    |                                  |
    |                          <------ wt_send(type: question)
    |                                  |
    |-- wt_send(type: answer) ------> |
    |                                  |
    |                          <------ wt_send(type: proposal)
    |                                  |
    |-- wt_send(type: agreement) ---> |
    |                                  |
    |-- wt_end(type: agreement) --->  |
    |                          <------ wt_end(type: agreement)
    |                                  |
    |       [Worker gera CONTRACT.md]  |
    |  [Worker spawna implementacao]   |
```

---

## Variaveis de ambiente do MCP Server

Estas variaveis sao configuradas no `.claude/settings.json` de cada projeto:

| Variavel | Obrigatoria | Descricao |
|----------|-------------|-----------|
| `WT_PROJECT_ID` | Sim | Identificador unico do projeto |
| `WT_PROJECT_PATH` | Sim | Caminho absoluto para a raiz do projeto |
| `REDIS_URL` | Sim | URL de conexao com Redis |
