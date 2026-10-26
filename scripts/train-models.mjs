import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {trainPipeline} from '../src/model-engine.mjs';
// Explicit, offline batch only. Never trains when a user opens the app.
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
if(!args.includes('--input')||!args.includes('--config')||!args.includes('--out'))throw Error('Usage: node scripts/train-models.mjs --input verified-rows.json --config frozen-protocol.json --out reports/run-name');
const inputText=await readFile(arg('--input'),'utf8'),configText=await readFile(arg('--config'),'utf8');
const rows=JSON.parse(inputText),config=JSON.parse(configText),sha=x=>createHash('sha256').update(x).digest('hex');
if(!Array.isArray(rows)||!config.frozenAt||Date.parse(config.frozenAt)>=Date.parse(config.boundaries?.policyEnd))throw Error('A frozen protocol dated before the final test is required.');
const report=trainPipeline(rows,config),evaluationId=sha(inputText+'\n'+configText);
report.evaluation_id=evaluationId;report.data_version=sha(inputText);report.protocol_hash=sha(configText);report.frozen_at=config.frozenAt;
if(report.models)for(const [type,model] of Object.entries(report.models)){
 model.scope=config.scope;model.protocol=report.protocol;model.evaluationId=evaluationId;
 model.calibratorVersion='cal-'+sha(JSON.stringify({temperature:model.temperature,dataVersion:report.data_version,split:report.splitManifest.B}));
 model.version='model-'+sha(JSON.stringify({model,split:report.splitManifest,dataVersion:report.data_version,protocol:report.protocol}));
 const policy=report.policies[type];policy.version='policy-'+sha(JSON.stringify({policy,modelVersion:model.version,protocol:report.protocol,split:report.splitManifest}));
 model.policy=policy;model.approved=false; // deployment requires a reviewed registry entry, never automatic training output
}
report.displayCandidate=report.operatingModel&&report.models?{modelVersion:report.models[report.operatingModel].version,policyVersion:report.policies[report.operatingModel].version}:null;
const out=resolve(arg('--out'));await mkdir(out,{recursive:true});
// Exclusive writes retain failed trials and prevent overwriting an earlier evaluation.
await writeFile(out+'/evaluation.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(out+'/protocol.json',configText,{flag:'wx'});
await writeFile(out+'/input-manifest.json',JSON.stringify({dataVersion:report.data_version,rows:rows.length,sourceFile:resolve(arg('--input')),evaluationId},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,evaluationId,status:report.status,trained:report.trainingCompleted===true,approved:report.modelApproved===true,policyApproved:report.policyApproved===true,reasons:report.reasonCodes}));
