// Illustrative public photographs; they are NOT observations from the selected field.
// Images remain credited to the original source pages.
export const cropPhotos = {
  wheat: {src:'/images/wheat.jpg',source:'https://unsplash.com/photos/LOJZ1mdBhr8',alt:'Golden wheat crop under a blue sky'},
  rice: {src:'/images/rice.jpg',source:'https://unsplash.com/photos/felsRL-gNLg',alt:'Green rice plants in a flooded paddy'},
  paddy: {src:'/images/paddy.jpg',source:'https://unsplash.com/photos/7ggElKPnJhM',alt:'Rice paddy in sunlight'},
  harvest: {src:'/images/harvest.jpg',source:'https://unsplash.com/photos/xDNcZyEuVDw',alt:'Golden crop stalks ready for harvest'},
  satellite: {src:'/images/satellite.png',source:'https://www.met.hu/idojaras/agrometeorologia/elemzes/index.php?id=3069&m=2',alt:'Sentinel-2 NDVI satellite agriculture mosaic'},
  maize: {src:'/images/maize.jpg',source:'https://images.unsplash.com/photo-1551754655-cd27e38d2076',alt:'Fresh corn cobs with green husks'},
  potato: {src:'/images/potato.jpg',source:'https://images.unsplash.com/photo-1518977676601-b53f82aba655',alt:'Freshly harvested potatoes'},
} as const;
export type CropPhoto = {src:string;source:string;alt:string};
export function cropPhoto(crop:string):CropPhoto {
  const name=crop.toLowerCase();
  if(name.includes('wheat')||name.includes('गेहूँ'))return cropPhotos.wheat;
  if(name.includes('rice')||name.includes('paddy')||name.includes('धान'))return cropPhotos.rice;
  if(name.includes('maize')||name.includes('corn'))return cropPhotos.maize;
  if(name.includes('potato'))return cropPhotos.potato;
  if(name.includes('mustard'))return cropPhotos.harvest;
  return cropPhotos.harvest;
}
