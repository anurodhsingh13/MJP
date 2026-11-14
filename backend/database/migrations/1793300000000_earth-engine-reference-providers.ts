import type {MigrationBuilder} from 'node-pg-migrate';
const original=['worldcover','chirps','soilgrids','worldcereal','cropharvest','fao-calendar'];
const earthEngine=['dynamicworld','sentinel1','era5land','smap','modis-ndvi','terrain','jrc-water'];
const list=(items:string[])=>items.map(item=>`'${item}'`).join(',');
/** Widen the provider allow-list for Earth Engine reference datasets. Existing rows are untouched. */
export async function up(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`alter table reference_dataset_runs drop constraint if exists reference_dataset_runs_provider_check;
  alter table reference_dataset_runs add constraint reference_dataset_runs_provider_check check(provider in (${list([...original,...earthEngine])}));`);
}
/** Rolling back removes only the Earth Engine rows, which the narrower constraint cannot hold. */
export async function down(pgm:MigrationBuilder):Promise<void>{
 pgm.sql(`delete from reference_dataset_runs where provider in (${list(earthEngine)});
  alter table reference_dataset_runs drop constraint if exists reference_dataset_runs_provider_check;
  alter table reference_dataset_runs add constraint reference_dataset_runs_provider_check check(provider in (${list(original)}));`);
}
