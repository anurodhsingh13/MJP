const MAX_PHOTO_BYTES=5*1024*1024;
const PHOTO_DATA_URL=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function photoSignature(bytes:Buffer):'jpeg'|'png'|'webp'|null{
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpeg';
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
 return null;
}
export function decodeScoutingImage(image:unknown):{bytes:Buffer;mime:'jpeg'|'png'|'webp'}|null{
 if(typeof image!=='string'||image.length>7*1024*1024)return null;
 const match=PHOTO_DATA_URL.exec(image);
 if(!match)return null;
 const encoded=match[2];
 if(encoded.length>Math.ceil(MAX_PHOTO_BYTES/3)*4)return null;
 const bytes=Buffer.from(encoded,'base64');
 if(!bytes.length||bytes.length>MAX_PHOTO_BYTES||bytes.toString('base64')!==encoded)return null;
 const mime=photoSignature(bytes);
 if(mime!==match[1])return null;
 return {bytes,mime};
}
export function validSanitizedJpeg(encoded:unknown,width:unknown,height:unknown):Buffer|null{
 if(typeof encoded!=='string'||!encoded.length||encoded.length>Math.ceil(MAX_PHOTO_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return null;
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length===0||bytes.length>MAX_PHOTO_BYTES||bytes.toString('base64')!==encoded||photoSignature(bytes)!=='jpeg')return null;
 if(typeof width!=='number'||typeof height!=='number'||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return null;
 return bytes;
}
