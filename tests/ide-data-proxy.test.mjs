import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { once } from 'node:events';
import { startIdeDataProxy } from '../.devcontainer/ide-data-proxy.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function reservePort() {
  return new Promise(async (resolve, reject) => {
    const server = net.createServer();
    try {
      const port = await listen(server);
      await close(server);
      resolve(port);
    } catch (error) {
      reject(error);
    }
  });
}

function readSocket(socket) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('end', () => resolve(Buffer.concat(chunks)));
    socket.once('error', reject);
  });
}

test('relays PostgreSQL traffic and returns SQLSTATE 57P03 when PostgreSQL is unavailable', async (t) => {
  const upstream = net.createServer((socket) => socket.pipe(socket));
  const upstreamPort = await listen(upstream);
  const proxy = await startIdeDataProxy({ postgresPort: 0, dynamoPort: 0, postgresUpstreamPort: upstreamPort, dynamoUpstreamPort: await reservePort() });
  t.after(async () => {
    await proxy.close();
    if (upstream.listening) await close(upstream);
  });

  const connected = net.createConnection({ host: '127.0.0.1', port: proxy.postgresAddress.port });
  const echoed = readSocket(connected);
  connected.write('startup');
  assert.equal((await once(connected, 'data'))[0].toString(), 'startup');
  connected.end();
  await echoed;

  await close(upstream);
  const unavailable = net.createConnection({ host: '127.0.0.1', port: proxy.postgresAddress.port });
  const response = readSocket(unavailable);
  unavailable.write(Buffer.from([0, 0, 0, 8, 0, 3, 0, 0]));
  const payload = await response;
  assert.equal(payload.readUInt8(0), 'E'.charCodeAt(0));
  assert.match(payload.toString('utf8'), /C57P03\0/);
  assert.match(payload.toString('utf8'), /P1 PostgreSQL container is unavailable/);
});

test('relays DynamoDB requests and returns a 503 AWS error when DynamoDB is unavailable', async (t) => {
  const upstream = http.createServer((request, response) => {
    assert.equal(request.headers['x-amz-target'], 'DynamoDB_20120810.ListTables');
    response.writeHead(200, { 'content-type': 'application/x-amz-json-1.0' });
    response.end('{"TableNames":[]}');
  });
  const upstreamPort = await listen(upstream);
  const proxy = await startIdeDataProxy({ postgresPort: 0, dynamoPort: 0, postgresUpstreamPort: await reservePort(), dynamoUpstreamPort: upstreamPort });
  t.after(async () => {
    await proxy.close();
    if (upstream.listening) await close(upstream);
  });

  const healthy = await fetch(`http://127.0.0.1:${proxy.dynamoAddress.port}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'DynamoDB_20120810.ListTables' },
    body: '{}',
  });
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { TableNames: [] });

  await close(upstream);
  const unavailable = await fetch(`http://127.0.0.1:${proxy.dynamoAddress.port}/`, { method: 'POST', body: '{}' });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    __type: 'com.amazonaws.dynamodb.v20120810#ServiceUnavailableException',
    message: 'P1 DynamoDB Local container is unavailable. Start the P1 Compose stack and retry.',
  });
});
