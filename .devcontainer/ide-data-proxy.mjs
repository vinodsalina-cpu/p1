import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = '127.0.0.1';
const CONNECT_TIMEOUT_MS = 2_000;
const POSTGRES_SSL_REQUEST = 80_877_103;

function integerEnvironment(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${name} must be a TCP port number.`);
  }
  return port;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function postgresUnavailableMessage() {
  const fields = Buffer.from(
    'SFATAL\0VFATAL\0C57P03\0MP1 PostgreSQL container is unavailable. Start the P1 Compose stack and retry.\0\0',
    'utf8',
  );
  const message = Buffer.alloc(5 + fields.length);
  message.writeUInt8('E'.charCodeAt(0), 0);
  message.writeUInt32BE(4 + fields.length, 1);
  fields.copy(message, 5);
  return message;
}

function replyPostgresUnavailable(client) {
  let initial = Buffer.alloc(0);
  const timeout = setTimeout(() => client.destroy(), CONNECT_TIMEOUT_MS);

  const sendError = () => {
    clearTimeout(timeout);
    client.end(postgresUnavailableMessage());
  };

  client.on('data', (chunk) => {
    initial = Buffer.concat([initial, chunk]);
    if (initial.length < 4) return;

    const messageLength = initial.readUInt32BE(0);
    if (messageLength < 8 || initial.length < messageLength) return;

    if (messageLength === 8 && initial.readUInt32BE(4) === POSTGRES_SSL_REQUEST) {
      client.write('N');
      initial = initial.subarray(8);
      if (initial.length < 4) return;
    }
    sendError();
  });
  client.once('close', () => clearTimeout(timeout));
  client.once('error', () => clearTimeout(timeout));
}

function createPostgresProxy({ host, upstreamHost, upstreamPort }) {
  return net.createServer((client) => {
    const upstream = net.createConnection({ host: upstreamHost, port: upstreamPort });
    let connected = false;
    const timeout = setTimeout(() => upstream.destroy(new Error('PostgreSQL upstream connection timed out.')), CONNECT_TIMEOUT_MS);

    const failBeforeConnect = () => {
      if (connected || client.destroyed) return;
      clearTimeout(timeout);
      upstream.destroy();
      replyPostgresUnavailable(client);
    };

    upstream.once('connect', () => {
      connected = true;
      clearTimeout(timeout);
      client.pipe(upstream).pipe(client);
    });
    upstream.once('error', failBeforeConnect);
    client.once('error', () => upstream.destroy());
    client.once('close', () => upstream.destroy());
  });
}

function dynamoUnavailable(response) {
  if (response.headersSent) return response.destroy();
  response.writeHead(503, {
    'content-type': 'application/x-amz-json-1.0',
    'x-amzn-requestid': crypto.randomUUID(),
  });
  response.end(JSON.stringify({
    __type: 'com.amazonaws.dynamodb.v20120810#ServiceUnavailableException',
    message: 'P1 DynamoDB Local container is unavailable. Start the P1 Compose stack and retry.',
  }));
}

function createDynamoProxy({ host, upstreamHost, upstreamPort }) {
  return http.createServer((request, response) => {
    const upstream = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.setTimeout(CONNECT_TIMEOUT_MS, () => upstream.destroy(new Error('DynamoDB upstream connection timed out.')));
    upstream.once('error', () => dynamoUnavailable(response));
    request.once('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
}

export async function startIdeDataProxy(options = {}) {
  const config = {
    host: options.host ?? process.env.P1_IDE_PROXY_HOST ?? DEFAULT_HOST,
    postgresPort: options.postgresPort ?? integerEnvironment('P1_IDE_PROXY_POSTGRES_PORT', 5432),
    dynamoPort: options.dynamoPort ?? integerEnvironment('P1_IDE_PROXY_DYNAMO_PORT', 8000),
    postgresUpstreamHost: options.postgresUpstreamHost ?? DEFAULT_HOST,
    postgresUpstreamPort: options.postgresUpstreamPort ?? integerEnvironment('P1_IDE_PROXY_POSTGRES_UPSTREAM_PORT', 15432),
    dynamoUpstreamHost: options.dynamoUpstreamHost ?? DEFAULT_HOST,
    dynamoUpstreamPort: options.dynamoUpstreamPort ?? integerEnvironment('P1_IDE_PROXY_DYNAMO_UPSTREAM_PORT', 18000),
  };
  const postgres = createPostgresProxy({
    host: config.host,
    upstreamHost: config.postgresUpstreamHost,
    upstreamPort: config.postgresUpstreamPort,
  });
  const dynamo = createDynamoProxy({
    host: config.host,
    upstreamHost: config.dynamoUpstreamHost,
    upstreamPort: config.dynamoUpstreamPort,
  });

  try {
    const [postgresAddress, dynamoAddress] = await Promise.all([
      listen(postgres, config.postgresPort, config.host),
      listen(dynamo, config.dynamoPort, config.host),
    ]);
    return {
      postgres,
      dynamo,
      postgresAddress,
      dynamoAddress,
      async close() {
        await Promise.all([close(postgres), close(dynamo)]);
      },
    };
  } catch (error) {
    await Promise.allSettled([close(postgres), close(dynamo)]);
    throw error;
  }
}

async function main() {
  const proxy = await startIdeDataProxy();
  const postgresPort = proxy.postgresAddress.port;
  const dynamoPort = proxy.dynamoAddress.port;
  console.log(`P1 IDE proxy listening on ${DEFAULT_HOST}:${postgresPort} (PostgreSQL) and ${DEFAULT_HOST}:${dynamoPort} (DynamoDB).`);

  const shutdown = async () => {
    await proxy.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
