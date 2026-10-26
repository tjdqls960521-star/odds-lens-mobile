// HTTPS/1.1 compatibility path for origins that fail the edge fetch TLS path.
// Certificate validation remains enabled; destinations are restricted to the
// public, read-only Betman endpoints. No insecure HTTP or relay is used.
export async function betmanHttps(url,options){
 const parsed=new URL(url);
 if(parsed.origin!=='https://www.betman.co.kr'||!['/buyPsblGame/inqCacheBuyAbleGameInfoList.do','/buyPsblGame/schedule.do','/buyPsblGame/gameInfoInq.do'].includes(parsed.pathname))throw Error('허용되지 않은 공식 조회 경로');
 const {connect}=await import('cloudflare:sockets');
 const socket=connect({hostname:parsed.hostname,port:443},{secureTransport:'on'});
 socket.closed.catch(()=>{});
 let timeout;
 try{
  const operation=(async()=>{
   await socket.opened;
   const encoder=new TextEncoder(),body=String(options.body||'');
   const request=`POST ${parsed.pathname} HTTP/1.1\r\nHost: ${parsed.hostname}\r\nContent-Type: application/json; charset=UTF-8\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nX-Requested-With: XMLHttpRequest\r\nReferer: https://www.betman.co.kr/\r\nConnection: close\r\nContent-Length: ${encoder.encode(body).length}\r\n\r\n${body}`;
   const writer=socket.writable.getWriter();await writer.write(encoder.encode(request));writer.releaseLock();
   const reader=socket.readable.getReader(),chunks=[];let size=0;
   while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10000000)throw Error('공식 응답 크기 초과');chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   return decodeHttp(bytes);
  })();
  return await Promise.race([operation,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('베트맨 HTTPS 연결 시간 초과')),12000);})]);
 }finally{clearTimeout(timeout);await socket.close().catch(()=>{});}
}

export function decodeHttp(bytes){
 const decoder=new TextDecoder(),headerEnd=bytes.findIndex((value,i)=>value===13&&bytes[i+1]===10&&bytes[i+2]===13&&bytes[i+3]===10);
 if(headerEnd<0)throw Error('공식 HTTPS 응답 헤더 오류');
 const lines=decoder.decode(bytes.slice(0,headerEnd)).split('\r\n'),status=Number(lines.shift().match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);
 if(!status)throw Error('공식 HTTPS 상태 코드 오류');
 const headers=new Headers();for(const line of lines){const i=line.indexOf(':');if(i>0)headers.append(line.slice(0,i),line.slice(i+1).trim());}
 let body=bytes.slice(headerEnd+4);
 if(headers.get('transfer-encoding')?.includes('chunked')){
  const chunks=[];let position=0,size=0;
  while(true){
   let end=position;while(end<body.length&&!(body[end]===13&&body[end+1]===10))end++;
   const length=Number.parseInt(decoder.decode(body.slice(position,end)).split(';')[0],16);
   if(!Number.isFinite(length)||end>=body.length)throw Error('공식 HTTPS chunk 형식 오류');
   position=end+2;if(length===0)break;
   if(position+length+2>body.length||body[position+length]!==13||body[position+length+1]!==10)throw Error('공식 HTTPS 응답 잘림');
   chunks.push(body.slice(position,position+length));size+=length;position+=length+2;
  }
  body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  headers.delete('transfer-encoding');headers.delete('content-length');
 }
 return new Response(body,{status,headers});
}
