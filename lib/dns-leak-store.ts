/**
 * Redis persistence for the DNS leak test — the only place the routes touch
 * storage. Server-only (imports ioredis); the pure logic lives in dns-leak.ts.
 *
 * Connection approach mirrors lib/rate-limit.ts exactly: one lazy ioredis
 * client per function instance from `REDIS_URL`, a 10 s backoff after a
 * failure, and every operation fails soft — the routes then report
 * `storage: 'none'` and the UI explains that the backend is not configured
 * (never a fake green).
 *
 * Keys (shared with scripts/dnsleak-server.mjs via lib/dns-leak.ts):
 *   dnsleak:test:<id>  string  JSON { createdAt, publicIp }   EXPIRE 600
 *   dnsleak:seen:<id>  list    JSON { resolverIp, ts, qname } EXPIRE 600 (written by the nameserver)
 */

import Redis from 'ioredis';
import {
  TEST_TTL_SECONDS,
  parseObservation,
  parseTestRecord,
  seenKey,
  testKey,
  type DnsLeakObservation,
  type DnsLeakStorage,
  type DnsLeakTestRecord,
} from './dns-leak';

let _client: Redis | null = null;
let _clientFailedAt: number | null = null;
const CLIENT_RETRY_DELAY_MS = 10_000;

function getClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (_clientFailedAt && Date.now() - _clientFailedAt < CLIENT_RETRY_DELAY_MS) return null;
  if (_client) return _client;
  try {
    _client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      retryStrategy: (times) => (times > 2 ? null : Math.min(times * 200, 1000)),
    });
    _client.on('error', () => {
      _clientFailedAt = Date.now();
    });
    return _client;
  } catch {
    _clientFailedAt = Date.now();
    return null;
  }
}

function markFailed(context: string, err: unknown): void {
  _clientFailedAt = Date.now();
  const msg = err instanceof Error ? err.message : 'unknown';
  console.error(`[dns-leak] Redis ${context} failed: ${msg.slice(0, 200)}`);
}

/** Record a new test. Returns which backend took the write. */
export async function createDnsLeakTest(id: string, publicIp: string | null): Promise<DnsLeakStorage> {
  const client = getClient();
  if (!client) return 'none';
  const record: DnsLeakTestRecord = { createdAt: Date.now(), publicIp };
  try {
    await client.set(testKey(id), JSON.stringify(record), 'EX', TEST_TTL_SECONDS);
    return 'redis';
  } catch (err) {
    markFailed('SET', err);
    return 'none';
  }
}

export interface DnsLeakReadResult {
  record: DnsLeakTestRecord | null;
  observations: DnsLeakObservation[];
  storage: DnsLeakStorage;
}

/** Read the test record and every observation the nameserver has pushed so far. */
export async function readDnsLeakTest(id: string): Promise<DnsLeakReadResult> {
  const client = getClient();
  if (!client) return { record: null, observations: [], storage: 'none' };
  try {
    const [raw, list] = await Promise.all([client.get(testKey(id)), client.lrange(seenKey(id), 0, -1)]);
    const observations: DnsLeakObservation[] = [];
    for (const entry of list) {
      const o = parseObservation(entry);
      if (o) observations.push(o);
    }
    return { record: parseTestRecord(raw), observations, storage: 'redis' };
  } catch (err) {
    markFailed('read', err);
    return { record: null, observations: [], storage: 'none' };
  }
}
