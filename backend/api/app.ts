import express, {type ErrorRequestHandler} from 'express';
import { router } from './routes/index.ts';

export const app = express();
app.use(express.json({limit:'128kb'}));
app.get('/', (_request, response) => response.json({ service: 'TerraScope API', health: '/api/health' }));
app.use('/api', router);

const bodyError:ErrorRequestHandler=(error: Error & {status?:number;type?:string},_request,response,next)=>{
  if(error.status===413) {response.status(413).json({error:'This boundary is too large. Import a smaller Polygon file (maximum 128 KB).'});return;}
  if(error.type==='entity.parse.failed') {response.status(400).json({error:'The submitted data is not valid JSON'});return;}
  next(error);
};
app.use(bodyError);
