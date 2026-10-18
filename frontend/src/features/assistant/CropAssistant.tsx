import { useEffect, useState, type FormEvent } from 'react';
import { Bot, MessageCircle, Send, X } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { askFieldAssistant } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';

type Message = { role: 'user'|'assistant'; text: string };
const prompts=[
 ['Why is NDVI decreasing?', 'NDVI कम क्यों हो रहा है?'],
 ['What should I inspect in my field?', 'खेत में क्या जाँच करनी चाहिए?'],
 ['Explain the weather data', 'मौसम की जानकारी समझाएँ'],
] as const;

export function CropAssistant() {
  const { t, language } = usePreferences();
  const location = useLocation();
  const { fieldId } = useParams();
  const match = location.pathname.match(/^\/fields\/([0-9a-f-]{36})(?:\/|$)/i);
  const selectedField = fieldId || match?.[1];
  const isDemo = document.documentElement.dataset.showcase === 'true';
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [providerStatus,setProviderStatus]=useState<'checking'|'configured'|'unconfigured'|'unavailable'>('checking');

  useEffect(() => {
    const onQuestion=(event:Event)=>{
      const detail=(event as CustomEvent<{question?:string}>).detail;
      if(typeof detail?.question === 'string')setQuestion(detail.question);
      setOpen(true);
    };
    window.addEventListener('terrascope:assistant-question',onQuestion);
    return ()=>window.removeEventListener('terrascope:assistant-question',onQuestion);
  },[]);

  useEffect(()=>{
    if(!open||isDemo)return;
    const controller=new AbortController();
    void fetch('/api/assistant/status',{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error('status unavailable');return response.json() as Promise<{configured:boolean}>;})
      .then(status=>setProviderStatus(status.configured?'configured':'unconfigured'))
      .catch(()=>{if(!controller.signal.aborted)setProviderStatus('unavailable');});
    return ()=>controller.abort();
  },[open,isDemo]);

  async function send(text:string) {
    const value = text.trim();
    if (!value || busy) return;
    setError('');
    setMessages(current => [...current, { role:'user', text:value }]);
    setQuestion('');
    setBusy(true);
    try {
      const response = await askFieldAssistant(value, selectedField, language === 'hi' ? 'hi-IN' : 'en-IN');
      setMessages(current => [...current, { role:'assistant', text:response.answer }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Assistant unavailable','सहायक उपलब्ध नहीं है'));
    } finally { setBusy(false); }
  }
  function submit(event:FormEvent) { event.preventDefault(); void send(question); }
  return <>
    <button className="crop-assistant-launch no-print" type="button" onClick={() => setOpen(current => !current)} aria-expanded={open} aria-controls="crop-assistant-window" aria-label={t('Ask crop assistant','फ़सल सहायक से पूछें')}>
      <MessageCircle size={22} aria-hidden="true"/><span>{t('Ask AI','AI से पूछें')}</span>
    </button>
    {open && <section id="crop-assistant-window" className="crop-assistant-window no-print" aria-label={t('Crop assistant chat','फ़सल सहायक चैट')}>
      <header className="crop-assistant-header">
        <div><strong><Bot size={21} aria-hidden="true"/> {t('Crop assistant','फ़सल सहायक')}</strong><small>{isDemo ? t('Sarvam AI interface · example answers','Sarvam AI इंटरफ़ेस · नमूना जवाब') : 'Sarvam AI'}{selectedField ? t(' · Selected field',' · चुना हुआ खेत') : ''}</small>{!isDemo&&<small role="status">{providerStatus==='configured'?t('Key configured · live connection not yet verified','API key सेट है · लाइव कनेक्शन की पुष्टि नहीं'):providerStatus==='unconfigured'?t('AI API key is missing on server','सर्वर पर AI API key नहीं है'):providerStatus==='unavailable'?t('Could not check AI configuration','AI की स्थिति नहीं मिल सकी'):t('Checking AI configuration…','AI की स्थिति जाँच रहे हैं…')}</small>}</div>
        <button type="button" aria-label={t('Close assistant','सहायक बंद करें')} onClick={() => setOpen(false)}><X size={20}/></button>
      </header>
      <div className="crop-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
        {!messages.length && <><p className="crop-assistant-intro">{t('Ask about your crop, satellite pictures or weather.', 'फ़सल, सैटेलाइट तस्वीर और मौसम के बारे में पूछें।')}</p>
          <div className="crop-assistant-prompts">{prompts.map(([en,hi])=><button key={en} type="button" onClick={() => void send(t(en,hi))} disabled={busy}>{t(en,hi)}</button>)}</div>
        </>}
        {messages.map((message,index)=><p key={index} className={message.role === 'user' ? 'assistant-user-message' : 'assistant-answer-message'}><span>{message.role==='user' ? t('You','आप') : t('Assistant','सहायक')}</span>{message.text}</p>)}
        {busy && <p role="status">{t('Writing reply…','जवाब तैयार हो रहा है…')}</p>}
      </div>
      {error && <p className="crop-assistant-error" role="alert">{error}</p>}
      <form className="crop-assistant-input" onSubmit={submit}>
        <label className="sr-only" htmlFor="crop-assistant-question">{t('Your question','आपका सवाल')}</label>
        <input id="crop-assistant-question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder={t('Ask a question…','अपना सवाल लिखें…')} maxLength={2000}/>
        <button type="submit" disabled={busy || !question.trim()} aria-label={t('Send question','सवाल भेजें')}><Send size={18}/></button>
      </form>
    </section>}
  </>;
}
