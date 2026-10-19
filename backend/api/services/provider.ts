/** Bounded retries for idempotent provider reads; never logs URLs or credentials. */
export async function providerJson(url:string,init:RequestInit={},timeoutMs=15000):Promise<unknown>{
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetch(url,{...init,signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok){
    if(attempt===0&&[429,502,503,504].includes(response.status)){await new Promise(resolve=>setTimeout(resolve,300));continue;}
    throw new Error(`External provider returned HTTP ${response.status}`);
   }
   return await response.json();
  }catch(error){if(attempt===1)throw error;if(error instanceof Error&&error.message.startsWith('External provider'))throw error;}
 }
 throw new Error('External provider unavailable');
}
