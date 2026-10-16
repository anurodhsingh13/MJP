#!/usr/bin/env node
// Non-destructive local validation; creates evidence logs under ignored .local/.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const options=new Set(process.argv.slice(2));
const dir=resolve(root,'.local','submission-evidence',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(dir,{recursive:true});
function check(name,cmd,args){
 const started=new Date().toISOString();
 const result=spawnSync(cmd,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,timeout:720000,env:process.env});
 const log=resolve(dir,name+'.log');
 writeFileSync(log,(result.stdout||'')+(result.stderr||'')+(result.error?'\n'+result.error.message:''),{mode:0o600});
 const status=result.status===0?'passed':'failed';
 console.log(status.toUpperCase(),name);
 return {name,status,started,ended:new Date().toISOString(),exitCode:result.status,log};
}
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
const dirty=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
const results=[
 check('build','npm',['run','build']),
 check('lint','npm',['run','lint']),
 check('node-tests','npm',['test']),
 check('python-tests',process.platform==='win32'?'python':resolve(root,'.venv','bin','python'),['-m','pytest','backend/engine','-q'])
];
if(!options.has('--skip-ui'))results.push(check('browser-tests','npm',['run','test:ui']));
if(options.has('--smoke')){
 const status=check('stack-status','npm',['run','status']);results.push(status);
 if(status.status==='passed')results.push(check('smoke','npm',['run','test:smoke']));
}
const summary={
 generatedAt:new Date().toISOString(),
 commit:git.status===0?git.stdout.trim():null,
 worktreeClean:dirty.status===0?dirty.stdout.trim()==='':null,
 environment:{platform:process.platform,arch:process.arch,node:process.version},
 limitations:['Browser tests mock API and map tiles; passing does not establish live satellite acceptance.','Satellite accuracy, field validation, human usability and faculty approval remain independent requirements.'],
 results
};
writeFileSync(resolve(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log('Submission evidence:',dir);
console.log('Checks passed:',results.filter(x=>x.status==='passed').length+'/'+results.length);
if(results.some(x=>x.status!=='passed'))process.exitCode=1;
