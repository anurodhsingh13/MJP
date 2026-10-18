import express, {type ErrorRequestHandler} from 'express';
import { router } from './routes/index.ts';
import {needsScoutingPhotoBody} from './services/requestLimits.ts';

export const app = express();
app.disable('x-powered-by');
app.use((_request,response,next)=>{
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','same-origin');
  response.setHeader('X-Frame-Options','DENY');
  response.setHeader('Permissions-Policy','geolocation=(self), camera=(self), microphone=()');
  next();
});
app.use(express.json({
  limit:'128kb',
  type:request=>!needsScoutingPhotoBody(request.method||'',request.url||'') && Boolean(request.headers['content-type']?.match(/^application\/json(?:\s*;|\s*$)/i)),
}));
app.get('/', (_request, response) => response.json({ service: 'TerraScope API', health: '/api/health' }));
app.use('/api', router);

const bodyError:ErrorRequestHandler=(error: Error & {status?:number;type?:string},request,response,next)=>{
  if(error.status===413) {response.status(413).json({error:request.path.includes('/scouting')?'Photo upload is too large. Use a JPEG, PNG or WebP under 5 MB.':'This request is too large. Field boundaries must be under 128 KB.'});return;}
  if(error.type==='entity.parse.failed') {response.status(400).json({error:'The submitted data is not valid JSON'});return;}
  next(error);
};
app.use(bodyError);
