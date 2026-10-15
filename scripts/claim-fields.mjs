import 'dotenv/config';
import pg from 'pg';
const [email,...ids]=process.argv.slice(2);
if(!email||!ids.length||ids.some(id=>!/^[-a-f0-9]{36}$/i.test(id)))throw new Error('Usage: node scripts/claim-fields.mjs existing-account-email explicit-field-uuid ...');
const url=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.toLowerCase().includes('terrascope'))throw new Error('This claim tool is restricted to a local TerraScope database');
const client=new pg.Client({connectionString:url.href});await client.connect();
try{await client.query('begin');const user=(await client.query('select id from app_users where email=$1',[email.toLowerCase()])).rows[0];if(!user)throw new Error('Create/sign in to this account before claiming records');
for(const id of ids){const field=(await client.query('update fields set owner_id=$2 where id=$1 and owner_id is null returning id,name',[id,user.id])).rows[0];if(!field)throw new Error('Field missing or already owned: '+id);await client.query('insert into field_claim_audit(field_id,user_id) values($1,$2)',[id,user.id]);await client.query('update ingestion_jobs set owner_id=$2 where field_id=$1',[id,user.id]);console.log('Claimed explicitly: '+field.name);}
await client.query('commit');}catch(error){await client.query('rollback');throw error;}finally{await client.end();}
