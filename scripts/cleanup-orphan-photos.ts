import {readdir,stat,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pool} from '../backend/api/db/pool.ts';

const NAME=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i;
export function isCandidate(name:string,ageMs:number,minAgeMs:number):boolean{
 return NAME.test(name)&&Number.isFinite(ageMs)&&ageMs>=minAgeMs;
}
export async function cleanOrphanPhotos(options:{root:string;apply:boolean;minAgeMs:number;now?:number}){
 const root=resolve(options.root);
 const results={examined:0,candidates:0,removed:0,skippedReferenced:0,errors:0,apply:options.apply};
 const entries=await readdir(root,{withFileTypes:true});
 for(const entry of entries){
  if(!entry.isFile()||!NAME.test(entry.name))continue;
  results.examined++;
  const file=resolve(root,entry.name);
  try{
   const info=await stat(file);
   if(!isCandidate(entry.name,(options.now??Date.now())-info.mtimeMs,options.minAgeMs))continue;
   // Recheck the DB before each deletion; on any DB failure, never delete.
   const ref=await pool.query('select 1 from scouting_photos where storage_key=$1 limit 1',[entry.name]);
   if(ref.rowCount){results.skippedReferenced++;continue;}
   results.candidates++;
   if(options.apply){
    const latest=await stat(file);
    if(latest.ino!==info.ino||latest.mtimeMs!==info.mtimeMs)continue;
    // Second DB check narrows the window where a concurrently committed upload could appear.
    const recheck=await pool.query('select 1 from scouting_photos where storage_key=$1 limit 1',[entry.name]);
    if(recheck.rowCount){results.skippedReferenced++;continue;}
    await unlink(file);
    results.removed++;
   }
  }catch(error){results.errors++;console.error('Skipped candidate:',entry.name,error instanceof Error?error.message:'unknown error');}
 }
 return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const apply=process.argv.includes('--apply');
 const root=process.env.PHOTO_STORAGE_DIR||'.local/scouting-photos';
 const minAgeMs=7*24*60*60*1000;
 try{
  const summary=await cleanOrphanPhotos({root,apply,minAgeMs});
  console.log(JSON.stringify(summary));
  if(summary.errors)process.exitCode=1;
 }catch(error){console.error('Orphan photo audit failed:',error);process.exitCode=1;}
 finally{await pool.end();}
}
