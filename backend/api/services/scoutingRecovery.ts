/** Never delete a photo whose database commit may have succeeded. */
export function shouldRemoveFailedUploadPhoto(fileWritten:boolean,commitAttempted:boolean):boolean{
 return fileWritten&&!commitAttempted;
}
export function duplicateScoutingCleanupKey(key:string|undefined):string|null{
 return key&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i.test(key)?key:null;
}
