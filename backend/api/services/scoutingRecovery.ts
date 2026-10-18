/** Never delete a photo whose database commit may have succeeded. */
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
