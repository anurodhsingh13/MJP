/** Routes with explicitly bounded larger JSON bodies; all other API routes remain at 128 KB. */
export function needsScoutingPhotoBody(method:string,path:string):boolean{
 const normalized=path.split('?',1)[0];
 return method==='POST'&&/^\/api\/fields\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/scouting(?:\/quality-preview)?$/i.test(normalized);
}
