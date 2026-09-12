import assert from 'node:assert/strict';
import test from 'node:test';
import {handleRequest} from './worker.js';

const site = 'https://worker.example';
const origin = 'https://maho37523.github.io';

function imageFetch(request) {
  assert.equal(request.headers.get('Range'), 'bytes=0-0');
  return new Response(new Uint8Array([7]), {
    status: 206,
    headers: {
      'Content-Length': '1',
      'Content-Range': 'bytes 0-0/100',
      'Content-Type': 'application/octet-stream',
    },
  });
}

test('allows one bounded IMG range and preserves CORS/range metadata', async () => {
  const request = new Request(`${site}/v1/ranceking/cd.img`, {
    headers: {Origin: origin, Range: 'bytes=0-0'},
  });
  const response = await handleRequest(request, imageFetch);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-0/100');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [7]);
});

test('rejects unbounded, multi-range and query-string IMG requests before upstream fetch', async () => {
  const neverFetch = () => assert.fail('must not fetch upstream');
  for (const path of [
    '/v1/ranceking/cd.img',
    '/v1/ranceking/cd.img?url=https://example.invalid',
  ]) {
    const response = await handleRequest(new Request(`${site}${path}`, {
      headers: {Origin: origin, Range: 'bytes=0-'},
    }), neverFetch);
    assert.equal(response.status, path.includes('?') ? 404 : 416);
  }
  const multi = await handleRequest(new Request(`${site}/v1/ranceking/cd.img`, {
    headers: {Range: 'bytes=0-0,2-2'},
  }), neverFetch);
  assert.equal(multi.status, 416);
});

test('rejects an upstream range mismatch instead of relaying it', async () => {
  const badUpstream = () => new Response(new Uint8Array([7]), {
    status: 206,
    headers: {'Content-Length': '1', 'Content-Range': 'bytes 1-1/100'},
  });
  const response = await handleRequest(new Request(`${site}/v1/ranceking/cd.img`, {
    headers: {Range: 'bytes=0-0'},
  }), badUpstream);
  assert.equal(response.status, 502);
});
