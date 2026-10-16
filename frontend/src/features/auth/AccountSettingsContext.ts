import {createContext,useContext} from 'react';
import type {ProfileValues} from '../../../../shared/profile';
export type AccountSettings={email:string;signedIn:boolean;profile:ProfileValues;saveProfile:(value:ProfileValues)=>Promise<void>;changePassword:(currentPassword:string,newPassword:string)=>Promise<void>;signOut:()=>Promise<void>};
export const AccountSettingsContext=createContext<AccountSettings|null>(null);
export function useAccountSettings(){const value=useContext(AccountSettingsContext);if(!value)throw new Error('Account settings unavailable');return value;}
