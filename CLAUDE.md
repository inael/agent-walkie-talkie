# CLAUDE.md — Convenções IT Booster pra este projeto

> Template copiado de `tools/catalog/template-projeto/CLAUDE.md` no monorepo ItBoosterEmpresa.
> Mantenha as 4 primeiras seções intactas (são convenções globais). Adicione regras específicas do projeto na seção final.

## 1. Credenciais

Toda credencial (API key, senha, token, URL de serviço) vive em `~/.claude/credentials/services.env` no laptop do dev e nos secrets do GitHub Actions / runtime de produção. **Nunca commitar `.env` real.** Use `.env.example` no repo apontando os nomes das variáveis.

Ao adicionar credencial nova: atualiza `services.env` global primeiro, depois `.env.example` aqui.

## 2. Catálogo IT Booster

Antes de propor integração com outro produto, ler o catálogo:
- `docs/catalogo/PROJETOS.md` no monorepo [`ItBoosterEmpresa`](https://github.com/inael/ItBoosterEmpresa/blob/master/docs/catalogo/PROJETOS.md).
- Ao criar projeto novo IT Booster, **adicionar `.itbooster-meta.yaml` na raiz** (template em `tools/catalog/template-projeto/.itbooster-meta.yaml`).
- Action diária regenera o catálogo automaticamente — não precisa atualizar à mão.

## 3. Git authoring

Todo commit em repos IT Booster (incluindo este) usa:

```bash
git commit --author="inael <inael.rodrigues@gmail.com>" -m "..."
```

Razão: a conta `inaelitbooster` (autor padrão do git config) **não é membro do team Vercel "IT Booster"** — commits dela bloqueiam deploys com "Deployment Blocked".

## 4. Status dashboard

Toda URL pública nova (`*.itbooster.com.br`, `*.toolpad.cloud`, dominios próprios) deve ser cadastrada em [`https://status.toolpad.cloud/`](https://status.toolpad.cloud/) (HTML em `/docker/dashboard/html/index.html` na VPS).

## 5. Garantia / Manutenção (apenas projetos de cliente)

Modelo padrão IT Booster:
- 2h grátis pós-entrega (ajustes + bugs)
- Evoluções cobradas por hora (acordar valor antes)

## 6. Narrativa "Hub de IA" em propostas

Em propostas comerciais nunca revelar LiteLLM/provedores específicos. Vender "acesso ao Hub de IA IT Booster" — só mostrar os modelos efetivamente usados.

## 7. Dados do cliente nunca na infra IT Booster

Backups, banco e arquivos de cliente sempre no storage pago pelo próprio cliente (Drive/Dropbox/VPS dele). VPS IT Booster é só pra produtos próprios.

---

## Regras específicas deste projeto

<!-- Adicione aqui o que é único deste projeto: stack peculiar, decisões arquiteturais, gotchas, comandos úteis, etc. -->

- Stack: ...
- Comandos:
  - `npm run dev` — sobe local
  - `npm run build` — build produção
- Decisões importantes:
  - ...
