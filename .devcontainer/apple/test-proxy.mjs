import net from 'node:net';
import { spawn } from 'node:child_process';
const mappings = [[8000, process.env.P1_DYNAMO_HOST, 8000], [54322, process.env.P1_DB_HOST, 5432], [54321, process.env.P1_EDGE_HOST, 9000]];
const servers = mappings.map(([port, host, upstreamPort]) => net.createServer(socket => {
  const upstream = net.connect(upstreamPort, host);
  socket.pipe(upstream).pipe(socket);
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
}));
await Promise.all(servers.map((server, i) => new Promise((resolve, reject) => {
  server.on('error', reject);
  server.listen(mappings[i][0], '127.0.0.1', resolve);
})));
const child = spawn('sh', ['-c', 'node .devcontainer/wait-services.mjs && pnpm build && pnpm test && pnpm check:architecture && pnpm test:integration'], { stdio: 'inherit', env: {
  ...process.env,
  DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
  SUPABASE_API_URL: 'http://127.0.0.1:54321',
  P1_TEST_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
}});
child.on('exit', code => { servers.forEach(s => s.close()); process.exit(code ?? 1); });
