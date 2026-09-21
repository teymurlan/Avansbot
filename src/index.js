import { requireActor } from './auth.js';
import { addAdvance, createBanquetWithAdvance, getAudit, getBanquetDetail, getStats, getUpcoming, updateBanquet } from './db.js';
import { isAdmin, validateAdvanceInput } from './lib.js';
import { notifyBanquetChanges, notifyNewAdvance, sendDailySummary, telegramWebhook } from './telegram.js';

export default {
  async fetch(request,env,ctx){
    try{
      const url=new URL(request.url);
      if(url.pathname==='/health')return json({ok:true,service:'avansbot'});
      if(url.pathname==='/telegram/webhook'&&request.method==='POST')return telegramWebhook(request,env,ctx);
      if(url.pathname.startsWith('/api/'))return api(request,env,url,ctx);
      return env.ASSETS.fetch(request);
    }catch(e){console.error(e);return json({ok:false,error:e?.message||'Внутренняя ошибка'},500);}
  },
  async scheduled(_controller,env,ctx){ctx.waitUntil(sendDailySummary(env));}
};

async function api(request,env,url,ctx){
  const auth=await requireActor(request,env); if(auth.error)return json({ok:false,error:auth.error},auth.status); const actor=auth.actor;
  if(url.pathname==='/api/bootstrap'&&request.method==='GET'){
    const [stats,upcoming]=await Promise.all([getStats(env),getUpcoming(env)]); return json({ok:true,actor,stats,upcoming});
  }
  if(url.pathname==='/api/advances'&&request.method==='POST'){
    const input=validateAdvanceInput(await body(request)); const result=await createBanquetWithAdvance(env,actor,input);
    ctx.waitUntil(notifyNewAdvance(env,actor,result.banquet,result.advance)); return json({ok:true,...result},201);
  }
  const b=url.pathname.match(/^\/api\/banquets\/(\d+)$/);
  if(b&&request.method==='GET'){
    const banquet=await getBanquetDetail(env,Number(b[1])); return banquet?json({ok:true,banquet}):json({ok:false,error:'Банкет не найден'},404);
  }
  if(b&&request.method==='PATCH'){
    const result=await updateBanquet(env,actor,Number(b[1]),await body(request)); if(!result)return json({ok:false,error:'Банкет не найден'},404);
    if(result.changes.length)ctx.waitUntil(notifyBanquetChanges(env,actor,result.banquet,result.changes)); return json({ok:true,...result});
  }
  const a=url.pathname.match(/^\/api\/banquets\/(\d+)\/advances$/);
  if(a&&request.method==='POST'){
    const amount=Math.round(Number((await body(request)).amount)); if(!Number.isFinite(amount)||amount<=0)return json({ok:false,error:'Укажите корректную сумму аванса'},400);
    const result=await addAdvance(env,actor,Number(a[1]),amount); if(!result)return json({ok:false,error:'Банкет не найден'},404);
    ctx.waitUntil(notifyNewAdvance(env,actor,result.banquet,result.advance)); return json({ok:true,...result},201);
  }
  if(url.pathname==='/api/audit'&&request.method==='GET'){
    if(!isAdmin(actor.id,env))return json({ok:false,error:'История доступна только администратору'},403); return json({ok:true,items:await getAudit(env)});
  }
  return json({ok:false,error:'Маршрут не найден'},404);
}

async function body(request){try{return await request.json();}catch{return {};}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
