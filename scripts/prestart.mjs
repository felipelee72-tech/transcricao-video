import { execSync } from 'node:child_process';

if (process.env.RENDER || process.env.NODE_ENV === 'production') {
  process.exit(0);
}

if (process.platform !== 'win32') {
  process.exit(0);
}

const port = Number(process.env.PORT) || 3001;

try {
  const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  const pids = new Set();

  for (const line of output.split('\n')) {
    if (!line.includes('LISTENING')) {
      continue;
    }

    const pid = Number.parseInt(line.trim().split(/\s+/).pop(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  for (const pid of pids) {
    console.log(`[prestart] encerrando processo ${pid} na porta ${port}`);
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
  }
} catch {
  console.log(`[prestart] porta ${port} livre`);
}
