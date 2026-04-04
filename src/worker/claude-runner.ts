import { execFile } from 'child_process';

const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || 'claude';
const TIMEOUT_MS = parseInt(process.env.ROUND_TIMEOUT_MS || '300000', 10); // 5 min

export function spawnClaude(projectPath: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLAUDE_CLI,
      ['-p', '--output-format', 'text', prompt],
      {
        cwd: projectPath,
        timeout: TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS}ms`));
          } else {
            reject(new Error(`Claude CLI error: ${error.message}\n${stderr}`));
          }
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}
