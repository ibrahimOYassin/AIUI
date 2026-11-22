import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import type { RunEvent } from '@aiui/shared';
import { type BuildInput, generate, plan } from './codegen/index.ts';
import { config } from './config.ts';

const EVENT_PREFIX = '@@AIUI ';

/**
 * Generates the Python project into a temporary folder, runs it once, and streams
 * its events to the browser as NDJSON. Closing the response stops the process.
 */
export function streamRun(build: BuildInput, input: unknown, res: Response, onEnd?: (status: 'success' | 'error' | 'stopped') => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiui-run-'));
  for (const file of generate(build, 'python')) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
  fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify(input ?? {}));

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const started = Date.now();
  let finished = false;
  let sawEnd = false;
  let stopReason: 'timeout' | 'client' | null = null;
  const send = (event: RunEvent) => {
    if (event.type === 'run_end' && !sawEnd) {
      sawEnd = true;
      onEnd?.(event.status);
    }
    if (!res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };
  send({ type: 'run_start', at: new Date().toISOString() });

  const child = spawn(config.python, ['main.py', '--events', '--once', '--input', '@input.json'], {
    cwd: dir,
    // Secrets reach the generated code only through its environment.
    env: { ...process.env, ...plan(build).secretEnv, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (!res.writableEnded) res.end();
    fs.rm(dir, { recursive: true, force: true }, () => undefined);
  };

  const timer = setTimeout(() => {
    stopReason = 'timeout';
    child.kill();
  }, config.runTimeoutMs);

  res.on('close', () => {
    if (!finished && child.exitCode === null) {
      stopReason ??= 'client';
      child.kill();
    }
  });

  const lines = (stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        onLine(buffer.slice(0, at).replace(/\r$/, ''));
        buffer = buffer.slice(at + 1);
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) onLine(buffer);
    });
  };

  lines(child.stdout, (line) => {
    if (line.startsWith(EVENT_PREFIX)) {
      try {
        send(JSON.parse(line.slice(EVENT_PREFIX.length)) as RunEvent);
        return;
      } catch {
        // fall through and show the raw line
      }
    }
    if (line.trim()) send({ type: 'stdout', text: line });
  });
  lines(child.stderr, (line) => {
    if (line.trim()) send({ type: 'log', level: 'error', message: line });
  });

  child.on('error', (error) => {
    const hint = (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? `Python was not found ("${config.python}"). Install Python 3.10+ or set AIUI_PYTHON.`
      : error.message;
    send({ type: 'run_end', status: 'error', error: hint, ms: Date.now() - started });
    finish();
  });

  child.on('close', (code) => {
    if (!sawEnd) {
      if (stopReason === 'timeout')
        send({ type: 'run_end', status: 'stopped', error: `Stopped after ${Math.round(config.runTimeoutMs / 1000)} seconds (time limit).`, ms: Date.now() - started });
      else if (stopReason === 'client') send({ type: 'run_end', status: 'stopped', ms: Date.now() - started });
      else send({ type: 'run_end', status: 'error', error: `The run ended unexpectedly (exit code ${code}).`, ms: Date.now() - started });
    }
    finish();
  });
}
