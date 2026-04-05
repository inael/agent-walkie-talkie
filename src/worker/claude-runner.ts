import { spawn } from 'child_process';

const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH || 'claude';
const TIMEOUT_MS = parseInt(process.env.ROUND_TIMEOUT_MS || '300000', 10); // 5 min
const IMPL_TIMEOUT_MS = parseInt(process.env.IMPL_TIMEOUT_MS || '600000', 10); // 10 min

/**
 * Spawn claude -p (read-only, no file editing)
 * Used for conversation rounds
 */
export function spawnClaude(projectPath: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_CLI, ['-p', '--output-format', 'text'], {
      cwd: projectPath,
      timeout: TIMEOUT_MS,
      env: { ...process.env },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Claude CLI spawn error: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}\n${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Spawn claude -p with --dangerously-skip-permissions
 * Used for post-agreement implementation — can edit files, run commands, commit
 */
export function spawnClaudeImplement(projectPath: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE_CLI,
      ['-p', '--dangerously-skip-permissions', '--output-format', 'text'],
      {
        cwd: projectPath,
        timeout: IMPL_TIMEOUT_MS,
        env: { ...process.env },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Claude implement spawn error: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude implement exited with code ${code}\n${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
