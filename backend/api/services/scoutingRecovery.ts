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
/** Ensure JPEG contains a scan section rather than only a forged frame header. */
export function jpegHasScan(bytes:Buffer):boolean{
 let offset=2;
 while(offset+1<bytes.length){
  if(bytes[offset]!==255)return false;
  while(offset<bytes.length&&bytes[offset]===255)offset++;
  if(offset>=bytes.length)return false;
  const marker=bytes[offset++];
  if(marker===218){
   if(offset+2>bytes.length)return false;
   const length=bytes.readUInt16BE(offset);
   if(length<6||offset+length>=bytes.length-2)return false;
   // A scan header alone is insufficient: require entropy data and the EOI marker.
   let scan=offset+length;
   let hasEntropy=false;
   while(scan<bytes.length-2){
    if(bytes[scan]!==255){hasEntropy=true;scan++;continue;}
    const marker=bytes[scan+1];
    if(marker===0){hasEntropy=true;scan+=2;continue;} // Byte-stuffed 0xFF
    if(marker>=208&&marker<=215){scan+=2;continue;} // Restart markers
    return false; // EOI inside payload, unsupported extra scans, or malformed marker
   }
   return hasEntropy&&scan===bytes.length-2&&bytes[scan]===255&&bytes[scan+1]===217;
  }
  if(marker===217)return false;
  if(marker===1||(marker>=208&&marker<=215))continue;
  if(offset+2>bytes.length)return false;
  const length=bytes.readUInt16BE(offset);
  if(length<2||offset+length>bytes.length)return false;
  offset+=length;
 }
 return false;
}
/** Verify file boundaries and encoded dimensions before confirming a recovered commit. */
export async function storedJpegReadable(root:string,key:unknown,width?:number,height?:number):Promise<boolean>{
 if(typeof key!=='string'||!duplicateScoutingCleanupKey(key))return false;
 try{
  const bytes=await readFile(resolve(root,key));
  if(bytes.length<4||bytes.length>5*1024*1024||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return false;
  const actual=jpegDimensions(bytes);
  if(!actual||actual.width>10000||actual.height>10000||!jpegHasScan(bytes))return false;
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

/** Recover only when the existing Pillow engine can fully decode the stored JPEG.
 * This avoids trusting headers or entropy markers alone, including for progressive JPEG.
 * Engine outages are treated as unknown outcomes, never as proof of a failed commit.
 */
export async function storedJpegDecodes(root:string,key:unknown,width:number,height:number,engineBase:string):Promise<boolean>{
 if(typeof key!=='string'||!duplicateScoutingCleanupKey(key))return false;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>2048||height>2048)return false;
 try{
  const bytes=await readFile(resolve(root,key));
  if(bytes.length<4||bytes.length>5*1024*1024||bytes[0]!==255||bytes[1]!==216)return false;
  const upstream=await fetch(engineBase.replace(/\\/$/,'')+'/inspect-photo',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({image:bytes.toString('base64')}),
   signal:AbortSignal.timeout(15000)
  });
  if(!upstream.ok)return false;
  const result=await upstream.json() as {width?:unknown;height?:unknown};
  return result.width===width&&result.height===height;
 }catch{return false;}
}
