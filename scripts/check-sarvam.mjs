import 'dotenv/config';

// Safe live-provider probe. Prints model and status only; never the key or reply.
const key=process.env.SARVAM_API_KEY?.trim();
const model=process.env.SARVAM_MODEL?.trim()||'sarvam-105b';
if(!key||key.startsWith('your-')){
 console.error('FAIL: SARVAM_API_KEY is missing in the project .env');
 process.exitCode=1;
}else{
 try{
  const response=await fetch('https://api.sarvam.ai/v1/chat/completions',{
   method:'POST',
   headers:{'api-subscription-key':key,'content-type':'application/json'},
   body:JSON.stringify({
    model,reasoning_effort:null,temperature:0.2,max_tokens:96,
    messages:[{role:'user',content:'Reply with only the word READY.'}]
   }),
   signal:AbortSignal.timeout(20000),
  });
  if(!response.ok){
   const reason=response.status===401||response.status===403?'API key rejected or model access denied'
    :response.status===402?'Insufficient account credits'
    :response.status===429?'Rate limit exceeded'
    :response.status===400?'Request or model configuration rejected'
    :`Provider returned HTTP ${response.status}`;
   console.error(`FAIL: ${reason}. HTTP ${response.status}. Model: ${model}`);
   process.exitCode=1;
  }else{
   const data=await response.json();
   const answer=data?.choices?.[0]?.message?.content;
   if(typeof answer==='string'&&answer.trim()){
    console.log(`PASS: live Sarvam chat request succeeded. Model: ${data.model||model}. Reply received.`);
   }else{
    console.error('FAIL: Sarvam returned success but an empty answer. Check completion token limit.');
    process.exitCode=1;
   }
  }
 }catch(error){
  console.error('FAIL: Sarvam network request failed or timed out:',error instanceof Error?error.message:'Unknown network error');
  process.exitCode=1;
 }
}
