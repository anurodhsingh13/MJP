import {enqueue,listJobs,retryJob} from '../services/jobs.ts';
import {createTask} from '../controllers/tasksController.ts';
import {deleteScouting,listScouting,photoContent,retryDiagnosis,saveScouting,listTasks,updateTask} from '../controllers/scoutingController.ts';
import express, { Router } from 'express';
import {session,sameOrigin,authRouter,requireAccount,requireField} from '../services/auth.ts';
import { getHealth } from '../controllers/healthController.ts';
import { askAssistant } from '../controllers/assistantController.ts';
import { 
  getFields, getFieldAlerts, resolveFieldAlert, updateFieldAlert, getFieldNdvi, getFieldNdviAnalysis,
  getFieldWeather, calculateNdviFromScene, processNdviSentinelHub, processLatestScene,
  getFieldScenes, ingestSentinelScenes, ingestWeather, 
  createField, updateBoundary, updateFieldLocation, updateField, deleteField,
  getFieldEvents, createFieldEvent, deleteFieldEvent,
  getFieldOverlay,
  getFieldTile
} from '../controllers/fieldsController.ts';

export const router = Router();
for (const parameter of ['fieldId', 'alertId', 'eventId','jobId','caseId','photoId','taskId']) {
  router.param(parameter, (_request, response, next, value: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      response.status(400).json({ error: `${parameter} must be a valid UUID` });
      return;
    }
    next();
  });
}

router.use(session,sameOrigin);
router.use('/auth',authRouter);
router.get('/health', getHealth);
router.use(requireAccount);
router.use('/fields/:fieldId',requireField);
router.use('/assistant',requireField);
router.post('/assistant', askAssistant);

router.get('/fields', getFields);
router.post('/fields', createField);
router.patch('/fields/:fieldId', updateField);
router.delete('/fields/:fieldId', deleteField);
router.patch('/fields/:fieldId/boundary',updateBoundary);
router.patch('/fields/:fieldId/location', updateFieldLocation);
router.post('/fields/:fieldId/jobs',enqueue);
router.get('/fields/:fieldId/jobs',listJobs);
router.post('/fields/:fieldId/jobs/:jobId/retry',retryJob);
router.get('/fields/:fieldId/alerts', getFieldAlerts);
router.patch('/fields/:fieldId/alerts/:alertId',updateFieldAlert);
router.patch('/fields/:fieldId/alerts/:alertId/resolve', resolveFieldAlert);
router.get('/fields/:fieldId/ndvi', getFieldNdvi);
router.get('/fields/:fieldId/ndvi/analysis', getFieldNdviAnalysis);
router.get('/fields/:fieldId/weather', getFieldWeather);
router.post('/fields/:fieldId/ndvi/from-scene/:sceneId', calculateNdviFromScene);
router.post('/fields/:fieldId/ndvi/process-latest', processLatestScene);
router.post('/fields/:fieldId/ndvi/process', processNdviSentinelHub);
router.get('/fields/:fieldId/scenes', getFieldScenes);
router.post('/fields/:fieldId/ingest/sentinel-scenes', ingestSentinelScenes);
router.post('/fields/:fieldId/ingest/weather', ingestWeather);
router.get('/fields/:fieldId/events', getFieldEvents);
router.get('/fields/:fieldId/overlay/:sceneId', getFieldOverlay);
router.get('/fields/:fieldId/tiles/:sceneId/:z/:x/:y.png', getFieldTile);
router.post('/fields/:fieldId/events', createFieldEvent);
router.delete('/fields/:fieldId/events/:eventId', deleteFieldEvent);
router.get('/fields/:fieldId/scouting',listScouting);
router.post('/fields/:fieldId/scouting',express.json({limit:'8mb'}),saveScouting);
router.delete('/fields/:fieldId/scouting/:caseId',deleteScouting);
router.post('/fields/:fieldId/scouting/:caseId/retry-diagnosis',retryDiagnosis);
router.get('/fields/:fieldId/scouting/:caseId/photos/:photoId',photoContent);
router.get('/fields/:fieldId/tasks',listTasks);
router.post('/fields/:fieldId/tasks',createTask);
router.patch('/fields/:fieldId/tasks/:taskId',updateTask);
