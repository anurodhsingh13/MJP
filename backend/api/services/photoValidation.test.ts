import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeScoutingImage,photoSignature,validSanitizedJpeg} from './photoValidation.ts';

const jpg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0xff,0xd9]);
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const webp=Buffer.from('RIFF1234WEBP','ascii');
test('accept matching JPEG PNG and WebP signatures',()=>{
 for(const [mime,bytes] of [['jpeg',jpg],['png',png],['webp',webp]] as const){
  const found=decodeScoutingImage(`data:image/${mime};base64,${bytes.toString('base64')}`);
  assert.equal(found?.mime,mime);
  assert.equal(photoSignature(bytes),mime);
 }
});
test('reject spoofed MIME, invalid base64, oversized photos and empty bytes',()=>{
 assert.equal(decodeScoutingImage(`data:image/png;base64,${jpg.toString('base64')}`),null);
 assert.equal(decodeScoutingImage('data:image/jpeg;base64,%%%'),null);
 assert.equal(decodeScoutingImage('data:image/jpeg;base64,'),null);
 assert.equal(decodeScoutingImage(`data:image/jpeg;base64,${Buffer.concat([jpg,Buffer.alloc(5*1024*1024)]).toString('base64')}`),null);
});
test('sanitizer must return JPEG with positive integral dimensions',()=>{
 assert.deepEqual(validSanitizedJpeg(jpg.toString('base64'),100,120),jpg);
 assert.equal(validSanitizedJpeg(png.toString('base64'),100,120),null);
 assert.equal(validSanitizedJpeg(jpg.toString('base64'),0,120),null);
 assert.equal(validSanitizedJpeg(jpg.toString('base64'),10.5,120),null);
});
