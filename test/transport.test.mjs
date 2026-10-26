import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeHttp} from '../src/betman-transport.mjs';
test('HTTPS compatibility preserves Korean UTF-8 through byte-counted chunks',async()=>{
 const encoder=new TextEncoder(),body=JSON.stringify({home:'두산 베어스',price:1.54});
 const bytes=encoder.encode(body),first=bytes.slice(0,13),second=bytes.slice(13);
 const parts=[encoder.encode('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n'),encoder.encode(first.length.toString(16)+'\r\n'),first,encoder.encode('\r\n'+second.length.toString(16)+'\r\n'),second,encoder.encode('\r\n0\r\n\r\n')];
 const wire=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const part of parts){wire.set(part,i);i+=part.length;}
 assert.deepEqual(await decodeHttp(wire).json(),JSON.parse(body));
 assert.throws(()=>decodeHttp(wire.slice(0,-5)),/chunk/);
});
