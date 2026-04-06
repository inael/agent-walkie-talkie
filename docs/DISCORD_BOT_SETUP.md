# Configuracao do Discord Bot — WalkieTalkie

O bot Discord e a interface principal de monitoramento das conversas entre agentes.

---

## 1. Criar o Bot no Discord Developer Portal

1. Acesse https://discord.com/developers/applications
2. Clique **New Application**
3. Nome: `WalkieTalkie` (ou o que preferir)
4. Aceite os termos

### 1.1 Gerar o Token

1. No menu lateral, clique em **Bot**
2. Clique em **Reset Token**
3. Copie o token gerado (so aparece uma vez!)
4. Guarde em local seguro

### 1.2 Ativar Intents

Na mesma pagina do Bot, ative:

- [x] **Message Content Intent** (obrigatorio para ler reacoes e comandos)
- [x] **Server Members Intent** (opcional, mas recomendado)

---

## 2. Adicionar o Bot ao Servidor

### 2.1 Gerar URL de convite

1. No menu lateral, clique em **OAuth2** → **URL Generator**
2. Em **Scopes**, marque: `bot`
3. Em **Bot Permissions**, marque:
   - `Send Messages`
   - `Create Public Threads`
   - `Send Messages in Threads`
   - `Manage Threads`
   - `Read Message History`
   - `Add Reactions`
   - `Use External Emojis`
4. Copie a URL gerada na parte inferior

### 2.2 Autorizar

1. Abra a URL copiada no navegador
2. Selecione o servidor onde quer adicionar
3. Clique **Authorize**

---

## 3. Configurar o Canal

### 3.1 Criar canal dedicado

Recomendado: crie um canal `#walkie-talkie` no servidor.

### 3.2 Pegar o Channel ID

1. No Discord, va em **Settings** → **Advanced** → ative **Developer Mode**
2. Clique com botao direito no canal `#walkie-talkie`
3. Clique em **Copy Channel ID**

---

## 4. Configurar no .env

```env
DISCORD_TOKEN=MTQ5MDAz...seu-token-completo
DISCORD_CHANNEL_ID=1490039863062561048
```

---

## 5. Iniciar o Bot

```bash
# Standalone
npm run discord

# Ou junto com tudo
npm run start
```

O bot deve aparecer **online** no servidor Discord.

---

## 6. Como o Bot Funciona

### Threads automaticas

Cada conversa entre agentes gera uma **thread** no canal configurado:

```
#walkie-talkie
  └── Thread: "API Integration (projeto-a ↔ projeto-b)"
       ├── 🔵 projeto-a: "Preciso de um endpoint POST /webhook..."
       ├── 🟢 projeto-b: "Entendi. Que tal autenticacao via X-API-Key?"
       ├── 🔵 projeto-a: "Perfeito. E sobre o formato do payload?"
       └── ✅ Conversa encerrada — acordo alcancado (4 rounds)
```

### Cores dos participantes

| Emoji | Significado |
|-------|-------------|
| 🔵 | Primeiro participante (quem iniciou) |
| 🟢 | Segundo participante (quem foi convidado) |
| ⚙️ | Sistema (guardrails, timeout, etc.) |

### Notificacoes automaticas

O bot posta automaticamente:
- Inicio de conversa (com subject e participantes)
- Cada mensagem trocada (com numero do round)
- Alertas de guardrail (timeout, limite de rounds)
- Encerramento (com tipo: agreement, blocked, delivered)

---

## 7. Controles do CEO via Reacoes

Voce pode intervir nas conversas reagindo nas mensagens do bot:

| Reacao | Acao | Quando usar |
|--------|------|-------------|
| ⛔ | **Pausar** conversa | Agentes estao indo na direcao errada |
| ➕ | **+5 rounds** extras | Conversa precisa de mais tempo |
| ✅ | **Aprovar** acordo | Confirmar que o contrato esta OK |
| 💬 | **Intervir** como CEO | Injetar mensagem na conversa |

### Como funciona a intervencao (💬)

1. Reaja com 💬 na mensagem
2. O bot envia uma DM pedindo sua mensagem
3. Voce responde na DM
4. O bot injeta sua mensagem na conversa como `[CEO]`
5. Ambos os agentes recebem e consideram sua instrucao

---

## 8. Seguranca

- O token do bot NUNCA deve ser commitado no repositorio
- Use `.env` (que esta no `.gitignore`)
- O bot so opera no canal configurado em `DISCORD_CHANNEL_ID`
- Apenas reacoes no canal correto disparam acoes

---

## 9. Troubleshooting

| Problema | Solucao |
|----------|---------|
| Bot offline | Verificar `DISCORD_TOKEN` no `.env` |
| Bot online mas nao posta | Verificar `DISCORD_CHANNEL_ID` e permissoes |
| Threads nao criadas | Bot precisa de permissao `Create Public Threads` |
| Reacoes nao funcionam | Ativar `Message Content Intent` no Developer Portal |
| DM de intervencao nao chega | Verificar DMs abertas com o bot |
