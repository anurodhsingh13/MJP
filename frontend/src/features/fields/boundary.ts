export type PolygonBoundary={type:'Polygon';coordinates:number[][][]};

export function validatePolygonBoundary(value:unknown):value is PolygonBoundary{
  if(!value||typeof value!=='object')return false;
  const geometry=value as {type?:unknown;coordinates?:unknown};
  if(geometry.type!=='Polygon'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<1||geometry.coordinates.length>50)return false;
  let count=0;
  return geometry.coordinates.every((ring:unknown)=>{
    if(!Array.isArray(ring)||ring.length<4)return false;
    count+=ring.length;if(count>5000)return false;
    const valid=ring.every((point:unknown)=>Array.isArray(point)&&point.length===2&&typeof point[0]==='number'&&Number.isFinite(point[0])&&Math.abs(point[0])<=180&&typeof point[1]==='number'&&Number.isFinite(point[1])&&Math.abs(point[1])<=90);
    return valid&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1];
  });
}

function ringArea(ring:number[][]){
  const radius=6378137;
  let area=0;
  for(let index=0;index<ring.length-1;index++){
    const [lon1,lat1]=ring[index];const [lon2,lat2]=ring[index+1];
    area+=(lon2-lon1)*Math.PI/180*(2+Math.sin(lat1*Math.PI/180)+Math.sin(lat2*Math.PI/180));
  }
  return Math.abs(area*radius*radius/2);
}

export function polygonAreaHectares(boundary:PolygonBoundary|null){
  if(!boundary||!validatePolygonBoundary(boundary))return 0;
  return Math.max(0,boundary.coordinates.reduce((total,ring,index)=>total+(index===0?1:-1)*ringArea(ring),0)/10000);
}
