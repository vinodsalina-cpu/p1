import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const patch = args.includes('--patch');
const runtimeIndex = args.indexOf('--runtime');
const runtime = runtimeIndex < 0 ? 'docker' : args[runtimeIndex + 1];
const allowed = new Set(['--patch', '--runtime', 'apple', 'docker']);
if (args.some(arg => !allowed.has(arg)) || !['apple', 'docker'].includes(runtime)) {
  console.error('Usage: pnpm build:environment [--runtime docker|apple] [--patch]');
  process.exit(2);
}
const env = { ...process.env, P1_NETWORK_PATCH: patch ? '1' : '0' };
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', env, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (runtime === 'apple') {
  if (patch) run('bash', ['.devcontainer/apple/network-check.sh']);
  run('container', ['build', ...(patch ? ['--dns', '192.168.64.1'] : []), '-t', 'p1-sup-aws:latest', '-f', '.devcontainer/Dockerfile', '.devcontainer']);
  // Recreate only pipeline-owned containers; named data volumes remain intact.
  for (const name of ['p1-apple-edge', 'p1-apple-rest', 'p1-apple-dynamo', 'p1-apple-db']) {
    if (spawnSync('container', ['inspect', name], { stdio: 'ignore' }).status === 0) {
      spawnSync('container', ['stop', name], { stdio: 'ignore' });
      run('container', ['delete', name]);
    }
  }
  run('bash', ['.devcontainer/apple/start.sh']);
  run('bash', ['.devcontainer/apple/test.sh']);
} else {
  if (patch) {
    console.error('--patch applies to this Mac’s Apple Container network. Use --runtime apple --patch. Docker/Colima requires its own verified DNS forwarding configuration.');
    process.exit(2);
  }
  const plugin = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
  const command = plugin ? 'docker' : 'docker-compose';
  const prefix = [...(plugin ? ['compose'] : []), '-f', '.devcontainer/compose.yaml'];
  run(command, [...prefix, 'up', '-d', '--build']);
  run(command, [...prefix, 'exec', '-T', 'dev', 'sh', '-c', 'pnpm install --frozen-lockfile && node .devcontainer/wait-services.mjs && pnpm build && pnpm test && pnpm check:architecture && pnpm test:integration']);
}
