/** Never delete a photo whose database commit may have succeeded. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/** Extract dimensions from a JPEG Start-of-Frame segment without decoding pixels. */
export function jpegDimensions(bytes:Buffer):{width:number;height:number}|null{
 if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)return null;
 let offset=2;
 while(offset+1<bytes.length){
  if(bytes[offset]!==255)return null;
  while(offset<bytes.length&&bytes[offset]===255)offset++;
  if(offset>=bytes.length)return null;
  const marker=bytes[offset++];
  if(marker===217||marker===218)return null;
  if(marker===1||(marker>=208&&marker<=215))continue;
  if(offset+2>bytes.length)return null;
  const length=bytes.readUInt16BE(offset);
  if(length<2||offset+length>bytes.length)return null;
  if([192,193,194,195,198,199,201,202,203,205,206,207].includes(marker)){
   if(length<7)return null;
   const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
   return width>0&&height>0?{width,height}:null;
  }
  offset+=length;
 }
 return null;
}
/** Verify file boundaries and encoded dimensions before confirming a recovered commit. */
export async function storedJpegReadable(root:string,key:unknown,width?:number,height?:number):Promise<boolean>{
 if(typeof key!=='string'||!duplicateScoutingCleanupKey(key))return false;
 try{
  const bytes=await readFile(resolve(root,key));
  if(bytes.length<4||bytes.length>5*1024*1024||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return false;
  const actual=jpegDimensions(bytes);
  if(!actual||actual.width>10000||actual.height>10000)return false;
  if(width!==undefined||height!==undefined)return Number.isInteger(width)&&Number.isInteger(height)&&actual.width===width&&actual.height===height;
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
