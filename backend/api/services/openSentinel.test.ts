import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseScenes,primaryTile,safeAssetUrl,sceneAssets,tileOf,type StacItem} from './openSentinel.ts';
import {historyWindow,pickHistoryScenes} from './history.ts';

const band=(name:string)=>({href:`https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/sentinel-2-c1-l2a/43/R/GK/2026/11/x/${name}.tif`,'raster:bands':[{scale:.0001,offset:-.1}]});
const item=(id:string,datetime:string,cloud:number,tile?:string):StacItem=>({id,geometry:null,properties:{datetime,'eo:cloud_cover':cloud,...(tile?{'grid:code':`MGRS-${tile}`}:{})},
 assets:{red:band('B04'),nir:band('B08'),scl:{href:band('SCL').href},blue:band('B02'),rededge1:band('B05'),swir16:band('B11')}});

test('MGRS tile comes from grid metadata, MGRS fields or the product id',()=>{
 assert.equal(tileOf(item('S2A_T43RGK_20261111T053939_L2A','2026-11-11T05:39:39Z',0,'43RGK')),'43RGK');
 assert.equal(tileOf({id:'x',properties:{'mgrs:utm_zone':5,'mgrs:latitude_band':'Q','mgrs:grid_square':'KB'}}),'05QKB');
 assert.equal(tileOf({id:'S2A_43RGL_20261111_1_L2A',properties:{}}),'43RGL');
 assert.equal(tileOf({id:'unknown',properties:{}}),null);
});
test('only public HTTPS object storage reaches the raster engine',()=>{
 assert.ok(safeAssetUrl(band('B04').href));
 assert.equal(safeAssetUrl('http://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/B04.tif'),null);
 assert.equal(safeAssetUrl('https://169.254.169.254/latest/meta-data'),null);
 assert.equal(safeAssetUrl('https://evil.example/amazonaws.com/B04.tif'),null);
 assert.equal(safeAssetUrl(42),null);
});
test('scenes without reflectance scale/offset or a cloud mask are not ingested',()=>{
 const good=item('a','2026-11-11T05:39:39Z',0,'43RGK');
 assert.deepEqual(Object.keys(sceneAssets(good)!).sort(),['blue','nir','red','rededge1','scl','swir16']);
 assert.equal(sceneAssets({...good,assets:{...good.assets,scl:{}}}),null);
 assert.equal(sceneAssets({...good,assets:{...good.assets,red:{href:band('B04').href}}}),null);
});
test('one scene per day from a single covering tile, keeping the stored tile',()=>{
 const items=[
  item('k11','2026-11-11T05:39:39Z',0,'43RGK'), item('l11','2026-11-11T05:39:39Z',0,'43RGL'),
  item('k09','2026-11-09T05:40:21Z',5,'43RGK'), item('l09','2026-11-09T05:40:21Z',1,'43RGL'),
  item('l04','2026-11-04T05:37:05Z',0,'43RGL'),
 ];
 const everything=new Set(items.map(entry=>entry.id));
 const first=chooseScenes(items,everything,null);
 assert.equal(first.tile,'43RGL'); // most frequent covering tile
 assert.deepEqual(first.scenes.map(entry=>entry.id),['l11','l09','l04']);
 const stored=chooseScenes(items,everything,'43RGK');
 assert.equal(stored.tile,'43RGK');
 assert.deepEqual(stored.scenes.map(entry=>entry.id),['k11','k09']);
 // A tile whose footprint does not cover the field is ignored while a covering tile exists.
 const partial=chooseScenes(items,new Set(['k11','k09']),null);
 assert.equal(partial.tile,'43RGK');
});
test('season history window starts before a recent sowing date and is bounded to a year',()=>{
 const now=Date.parse('2026-11-12T12:00:00Z');
 assert.deepEqual(historyWindow('2026-07-01',now),{start:'2026-06-16',end:'2026-11-13',fromSowing:true});
 const old=historyWindow('2024-11-10',now);
 assert.equal(old.fromSowing,false);
 assert.equal(old.start,'2026-05-16');
 assert.equal(historyWindow(null,now).start,'2026-05-16');
});
test('history picks the least cloudy image per 10-day bin and skips bins already measured',()=>{
 const end=Date.parse('2026-11-12T00:00:00Z');
 const scene=(id:string,day:string,cloud:number,extra:Partial<{accepted:boolean;processing_status:string;same_boundary:boolean}>={})=>({scene_id:id,observed_at:`${day}T05:40:00Z`,cloud_cover:cloud,tile_id:'43RGK',accepted:false,processing_status:null,same_boundary:false,...extra});
 const picks=pickHistoryScenes([
  scene('a','2026-11-10',20), scene('b','2026-11-08',2),
  scene('c','2026-10-30',0,{accepted:true}), scene('d','2026-10-28',9),
  scene('e','2026-10-20',3,{processing_status:'rejected',same_boundary:true}), scene('f','2026-10-18',30),
 ],end,10,10);
 assert.deepEqual(picks.map(entry=>entry.scene_id),['b','f']);
 assert.equal(pickHistoryScenes([scene('a','2026-11-10',1),scene('b','2026-10-30',1)],end,10,1).length,1);
});

test('primary tile keeps the stored tile, else the most frequent, ties alphabetical',()=>{
 assert.equal(primaryTile(['44RNQ','44RNP','44RNQ'],null),'44RNQ');
 assert.equal(primaryTile(['44RNQ','44RNP'],null),'44RNP');
 assert.equal(primaryTile(['44RNQ','44RNP','44RNP'],'44RNQ'),'44RNQ');
 assert.equal(primaryTile(['44RNP'],'44RNQ'),'44RNP');
 assert.equal(primaryTile([null,null],null),null);
 assert.equal(primaryTile([],null),null);
});
