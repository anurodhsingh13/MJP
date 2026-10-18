/** Never delete a photo whose database commit may have succeeded. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/** Verify stored JPEG bytes before acknowledging a recovered commit. */
export async function storedJpegReadable(root:string,key:unknown,width?:number,height?:number):Promise<boolean>{
 if(typeof key!=='string'||!duplicateScoutingCleanupKey(key))return false;
 try{
  const bytes=await readFile(resolve(root,key));
  if(bytes.length<4||bytes.length>5*1024*1024||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)return false;
  if(width!==undefined||height!==undefined)return Number.isInteger(width)&&Number.isInteger(height)&&(width as number)>0&&(height as number)>0&&(width as number)<=10000&&(height as number)<=10000;
  return true;
 }catch{return false;}
}
export function shouldRemoveFailedUploadPhoto(fileWritten:boolean,commitAttempted:boolean):boolean{
 return fileWritten&&!commitAttempted;
}
export function duplicateScoutingCleanupKey(key:string|undefined):string|null{
 return key&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i.test(key)?key:null;
}

/** A commit reply may be lost after PostgreSQL has committed.
 * Only roll back when commit has not started; rollback errors must not mask the original failure.
 */
export async function rollbackBeforeCommit(
 query:(sql:string)=>Promise<unknown>,
 commitAttempted:boolean,
 log:(error:unknown)=>void=()=>{}
):Promise<boolean>{
 if(commitAttempted)return false;
 try{await query('rollback');return true;}
 catch(error){log(error);return false;}
}

/** Confirm a possibly committed upload through a fresh read connection.
 * An unavailable database means unknown, never "definitely rolled back".
 */
export async function reconcileScoutingCommit<T>(
 lookup:()=>Promise<T|null|undefined>,
 complete:(value:T)=>boolean=()=>true
):Promise<{status:'committed';value:T}|{status:'unknown'}>{
 try{
  const value=await lookup();
  return value==null||!complete(value)?{status:'unknown'}:{status:'committed',value};
 }catch{
  return {status:'unknown'};
 }
}
