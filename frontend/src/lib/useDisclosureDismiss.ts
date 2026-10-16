import {useEffect,useRef} from 'react';

export function useDisclosureDismiss(){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(ref.current?.open&&!ref.current.contains(event.target as Node))ref.current.open=false;};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&ref.current?.open){ref.current.open=false;ref.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[]);
 return ref;
}
