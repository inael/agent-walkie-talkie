/**
 * Skip the conversation — go straight to implementation.
 * Reads an existing contract and spawns claude --dangerously-skip-permissions
 * on both projects to implement it.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { spawnClaudeImplement } from './src/worker/claude-runner.js';

const PROJECTS = [
  {
    id: 'itbooster',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/ItBooster',
  },
  {
    id: 'freelanceia',
    path: 'C:/Users/inael-pc/Documents/ClaudeCode/FreelanceIA',
  },
];

const CONTRACT_PATH = process.argv[2] || './contracts/freelanceia-itbooster.md';

async function main() {
  console.log('=== WalkieTalkie — Direct Implementation ===\n');

  const contract = readFileSync(CONTRACT_PATH, 'utf-8');
  console.log(`📋 Contract loaded: ${CONTRACT_PATH} (${contract.length} chars)\n`);

  const results = await Promise.allSettled(
    PROJECTS.map(async (project) => {
      const other = PROJECTS.find(p => p.id !== project.id)!;

      console.log(`🔧 [${project.id}] Starting implementation...`);

      const prompt = `Você é o agente do projeto "${project.id}".
IMPORTANTE: Responda SEMPRE em português brasileiro.

## Tarefa
Um contrato de integração foi acordado entre "${project.id}" e "${other.id}".
Você deve IMPLEMENTAR o que foi acordado — APENAS o lado do "${project.id}".

## Contrato

${contract}

## Instruções
1. Leia os arquivos relevantes do codebase ANTES de modificar qualquer coisa.
2. Implemente APENAS o que está na seção "Next Steps > ${project.id} side".
3. Considere a infraestrutura existente: Docker, Redis, Tailscale, N8N, Evolution API, Discord Bot.
4. Priorize reuso — reaproveite código existente, não reinvente.
5. Faça mudanças pequenas, reversíveis e testáveis.
6. Atualize docs/context/ com o que foi implementado (DECISIONS.md se houve decisão arquitetural).
7. Faça git add + git commit com mensagem descritiva (feat: implementar integração ...).
8. NÃO faça git push — deixe para o humano revisar.
9. Retorne um RESUMO claro do que foi feito: arquivos criados/modificados, endpoints, o que testar.

## Regras
- NÃO implemente o lado do outro projeto ("${other.id}").
- NÃO faça refactor além do necessário.
- NÃO crie arquivos de plano — implemente direto.
- Se algo estiver ambíguo, escolha a opção mais simples.
- Se precisar de uma variável de ambiente nova, documente no .env.example.`;

      const result = await spawnClaudeImplement(project.path, prompt);
      console.log(`✅ [${project.id}] Done (${result.length} chars)`);
      console.log(`\n--- ${project.id} summary ---\n${result.slice(0, 500)}...\n`);
      return result;
    })
  );

  console.log('\n=== Results ===');
  for (let i = 0; i < PROJECTS.length; i++) {
    const r = results[i];
    const p = PROJECTS[i];
    if (r.status === 'fulfilled') {
      console.log(`✅ ${p.id}: implemented successfully`);
    } else {
      console.log(`❌ ${p.id}: FAILED — ${(r as PromiseRejectedResult).reason?.message}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
