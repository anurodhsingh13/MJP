// Illustrative public photographs; they are NOT observations from the selected field.
// Images remain credited to the original source pages.
export const cropPhotos = {
  wheat: {src:'https://images.unsplash.com/photo-1734022479478-4b671d839185?w=1000&q=80&fit=crop',source:'https://unsplash.com/photos/LOJZ1mdBhr8',alt:'Golden wheat crop under a blue sky'},
  rice: {src:'https://images.unsplash.com/photo-1655994967766-5de5d2ebb7ac?w=1000&q=80&fit=crop',source:'https://unsplash.com/photos/felsRL-gNLg',alt:'Green rice plants in a flooded paddy'},
  paddy: {src:'https://images.unsplash.com/photo-1675271875564-87f130c63b6f?w=1000&q=80&fit=crop',source:'https://unsplash.com/photos/7ggElKPnJhM',alt:'Rice paddy in sunlight'},
  harvest: {src:'https://images.unsplash.com/photo-1760286834274-4f13c9747f7d?w=1000&q=80&fit=crop',source:'https://unsplash.com/photos/xDNcZyEuVDw',alt:'Golden crop stalks ready for harvest'},
  satellite: {src:'https://www.met.hu/metadmin/pic/2019/01/a9e271ce868305ad3c966583f33cd42e-szombathely-del-20190121.png',source:'https://www.met.hu/idojaras/agrometeorologia/elemzes/index.php?id=3069&m=2',alt:'Sentinel-2 NDVI satellite agriculture mosaic'},
} as const;
export type CropPhoto = {src:string;source:string;alt:string};
export function cropPhoto(crop:string):CropPhoto {
  const name=crop.toLowerCase();
  if(name.includes('wheat')||name.includes('गेहूँ'))return cropPhotos.wheat;
  if(name.includes('rice')||name.includes('paddy')||name.includes('धान'))return cropPhotos.rice;
  if(name.includes('maize')||name.includes('corn'))return cropPhotos.harvest;
  if(name.includes('mustard'))return cropPhotos.paddy;
  return cropPhotos.harvest;
}
