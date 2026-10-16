export type ProfileValues={name:string;phone:string;farmName:string;location:string;bio:string};
export const emptyProfile:ProfileValues={name:'',phone:'',farmName:'',location:'',bio:''};
export function validateProfile(value:unknown):ProfileValues{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Enter valid profile details');
 const input=value as Record<string,unknown>;
 const limits:Record<keyof ProfileValues,number>={name:60,phone:25,farmName:100,location:160,bio:500};
 const profile={...emptyProfile};
 for(const key of Object.keys(limits) as (keyof ProfileValues)[]){
  if(input[key]!==undefined&&typeof input[key]!=='string')throw new Error('Profile details must be text');
  const text=((input[key] as string|undefined)||'').trim();
  if(text.length>limits[key])throw new Error(`${key} is too long`);
  profile[key]=text;
 }
 if(profile.phone&&(!/^\+?[\d ()-]{7,25}$/.test(profile.phone)||profile.phone.replace(/\D/g,'').length<7||profile.phone.replace(/\D/g,'').length>15))throw new Error('Enter a valid phone number');
 return profile;
}
