import { createContext, useContext } from 'react';
export type FarmerAccount = { id:string; email:string; displayName:string } | null;
export const FarmerAccountContext = createContext<FarmerAccount>(null);
export const useFarmerAccount = () => useContext(FarmerAccountContext);
