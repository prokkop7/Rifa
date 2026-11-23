import {readFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import pg from "pg";

const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw Error("DATABASE_URL required");
const pool=new pg.Pool({connectionString,ssl:false});
try{
  const sql=readFileSync(new URL("../../database/schema.sql",import.meta.url),"utf8");
  await pool.query(sql);
  for(const migration of ["002_reservations.sql","003_asaas_checkout.sql","004_provider_settings.sql"]){
    await pool.query(readFileSync(new URL("../../database/"+migration,import.meta.url),"utf8"));
  }
  const tables=await pool.query("select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('campaigns','entries','participants','participant_accounts','participant_sessions','payment_provider_settings','number_reservations')");
  if(tables.rows[0].n!==7)throw Error("Database tables missing");
  console.log("SQL initialization succeeded");
}finally{await pool.end()}

const api=spawn(process.execPath,["src/index.js"],{cwd:new URL("../",import.meta.url).pathname,env:process.env,stdio:"inherit"});
try{
  let ready=false;
  for(let i=0;i<30;i++){
    if(api.exitCode!==null)throw Error("API crashed");
    try{
      const r=await fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/api/health");
      const data=await r.json();
      if(r.ok&&data.ok===true){ready=true;break}
    }catch{}
    await delay(300);
  }
  if(!ready)throw Error("API health failed");
  console.log("API health succeeded");
}finally{api.kill("SIGTERM")}
