"use client";
import { useState, useCallback, useEffect } from "react";

// ════════════════════════════════════════════════════════════════════
// MATH
// ════════════════════════════════════════════════════════════════════
function erf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1; x=Math.abs(x);
  const t=1/(1+p*x);
  return sign*(1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x));
}
function normCDF(x){return 0.5*(1+erf(x/Math.sqrt(2)));}
function normPDF(x){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}

function bs({S,K,T,r,sigma,type}){
  if(T<=0||sigma<=0||S<=0||K<=0) return null;
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  const price=type==="call"?S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2):K*Math.exp(-r*T)*normCDF(-d2)-S*normCDF(-d1);
  const delta=type==="call"?normCDF(d1):normCDF(d1)-1;
  const gamma=normPDF(d1)/(S*sigma*Math.sqrt(T));
  const theta=type==="call"?(-S*normPDF(d1)*sigma/(2*Math.sqrt(T))-r*K*Math.exp(-r*T)*normCDF(d2))/365:(-S*normPDF(d1)*sigma/(2*Math.sqrt(T))+r*K*Math.exp(-r*T)*normCDF(-d2))/365;
  const vega=S*normPDF(d1)*Math.sqrt(T)/100;
  const probOTM=type==="call"?normCDF(-d2)*100:normCDF(d2)*100;
  return {price,delta,gamma,theta,vega,probOTM};
}

function impliedVol({S,K,T,r,marketPrice,type}){
  let lo=0.001,hi=5,mid,iter=0;
  while(iter++<100){
    mid=(lo+hi)/2;
    const res=bs({S,K,T,r,sigma:mid,type});
    if(!res) return null;
    if(Math.abs(res.price-marketPrice)<0.0001) break;
    if(res.price<marketPrice) lo=mid; else hi=mid;
  }
  return mid;
}

function calcHistVol(prices){
  if(!prices||prices.length<2) return null;
  const returns=[];
  for(let i=1;i<prices.length;i++) returns.push(Math.log(prices[i]/prices[i-1]));
  const mean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1);
  return Math.sqrt(variance*252)*100;
}

function selicPeriodo(taxa,dias){return(Math.pow(1+taxa,dias/365)-1)*100;}

function getNextExpiry(){
  const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+1);
  let f=0;
  while(f<3){if(d.getDay()===5)f++;if(f<3)d.setDate(d.getDate()+1);}
  return d.toISOString().split("T")[0];
}

function diasAte(data){
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  return Math.max(0,Math.round((new Date(data)-hoje)/86400000));
}

// ════════════════════════════════════════════════════════════════════
// API
// ════════════════════════════════════════════════════════════════════
async function fetchAtivo(ticker){
  const r=await fetch(`/api/brapi/${ticker}`);
  return r.json();
}

// ════════════════════════════════════════════════════════════════════
// DECISION
// ════════════════════════════════════════════════════════════════════
function decide({iv,ivHist,delta,premioPercent,dias,taxa}){
  const signals=[]; let score=0;
  const spread=iv-ivHist;
  if(spread>=15){signals.push({t:"ok",text:`IV ${iv.toFixed(0)}% está ${spread.toFixed(0)}p acima da histórica — ótimo`});score+=2;}
  else if(spread>=8){signals.push({t:"ok",text:`IV ${iv.toFixed(0)}% está ${spread.toFixed(0)}p acima da histórica — bom`});score+=1;}
  else if(spread>=0){signals.push({t:"warn",text:`IV apenas ${spread.toFixed(0)}p acima da histórica — margem mínima`});}
  else{signals.push({t:"bad",text:`IV abaixo da histórica — vendendo volatilidade barata`});score-=2;}

  const ad=Math.abs(delta);
  if(ad>=0.25&&ad<=0.35){signals.push({t:"ok",text:`Delta ${(ad*100).toFixed(0)} — strike no ponto ótimo`});score+=1;}
  else if(ad>0.35&&ad<=0.45){signals.push({t:"warn",text:`Delta ${(ad*100).toFixed(0)} — um pouco próximo`});}
  else if(ad>0.45){signals.push({t:"bad",text:`Delta ${(ad*100).toFixed(0)} — exercício provável`});score-=1;}
  else{signals.push({t:"warn",text:`Delta ${(ad*100).toFixed(0)} — muito OTM, prêmio baixo`});}

  if(dias>=20&&dias<=35){signals.push({t:"ok",text:`${dias} dias — prazo ideal`});score+=1;}
  else if(dias>35&&dias<=50){signals.push({t:"warn",text:`${dias} dias — prazo razoável`});}
  else if(dias>50){signals.push({t:"warn",text:`${dias} dias — prazo longo`});}
  else{signals.push({t:"warn",text:`${dias} dias — pouco tempo`});}

  const sp=selicPeriodo(taxa,dias);
  if(premioPercent>=sp*1.5){signals.push({t:"ok",text:`Prêmio ${premioPercent.toFixed(2)}% bate Selic do período (${sp.toFixed(2)}%) em ${(premioPercent/sp).toFixed(1)}×`});score+=1;}
  else if(premioPercent>=sp){signals.push({t:"warn",text:`Prêmio ${premioPercent.toFixed(2)}% bate Selic (${sp.toFixed(2)}%) mas sem folga`});}
  else{signals.push({t:"bad",text:`Prêmio ${premioPercent.toFixed(2)}% não bate Selic do período (${sp.toFixed(2)}%)`});score-=1;}

  const v=score>=4?"LANÇAR":score>=2?"LANÇAR COM CAUTELA":score>=0?"AGUARDAR":"NÃO LANÇAR";
  const col=score>=4?"#34D399":score>=2?"#FBBF24":score>=0?"#FB923C":"#F87171";
  return{verdict:v,color:col,score,signals,sp};
}

// ════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ════════════════════════════════════════════════════════════════════
const C={
  bg:"#0B0E14",
  bgGradient:"radial-gradient(ellipse 1200px 620px at 50% -12%, #161B2C 0%, #0B0E14 55%)",
  card:"#12161F",
  border:"#262C39",
  borderSoft:"#1D2230",
  accent:"#5B8DEF",
  accent2:"#7C6CF0",
  green:"#34D399",
  yellow:"#FBBF24",
  orange:"#FB923C",
  red:"#F87171",
  text:"#EDEFF3",
  muted:"#8A94A6",
  input:"#171B24",
};

const iS=(extra={})=>({width:"100%",background:C.input,border:`1px solid ${C.border}`,
  borderRadius:8,padding:"9px 11px",color:C.text,fontSize:13,outline:"none",
  boxSizing:"border-box",fontFamily:"var(--font-mono)",...extra});

// ════════════════════════════════════════════════════════════════════
// ICONS
// ════════════════════════════════════════════════════════════════════
function Icon({name,size=18,style={}}){
  const p={width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",
    strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round",style:{flexShrink:0,...style}};
  switch(name){
    case"zap":return<svg{...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case"bars":return<svg{...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
    case"clipboard":return<svg{...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>;
    case"refresh":return<svg{...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
    case"trending":return<svg{...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case"check":return<svg{...p}><polyline points="20 6 9 17 4 12"/></svg>;
    case"alert":return<svg{...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case"x":return<svg{...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    case"logout":return<svg{...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
    case"target":return<svg{...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
    case"save":return<svg{...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
    case"info":return<svg{...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;
    case"external":return<svg{...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
    case"circle":return<svg{...p}><circle cx="12" cy="12" r="9"/></svg>;
    default:return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// BASE COMPONENTS
// ════════════════════════════════════════════════════════════════════
function Fld({label,children,hint}){
  return(
    <div style={{marginBottom:10}}>
      <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>{label}</div>
      {children}
      {hint&&<div style={{fontSize:10.5,color:C.muted,marginTop:4}}>{hint}</div>}
    </div>
  );
}

function Card({children,style={}}){
  return <div className="op-card" style={{background:C.card,border:`1px solid ${C.borderSoft}`,
    borderRadius:14,padding:18,boxShadow:"0 1px 2px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.18)",...style}}>{children}</div>;
}

function SectionTitle({children,color}){
  return <div style={{fontSize:11,fontWeight:700,color:color||C.muted,textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:12}}>{children}</div>;
}

function Metric({label,value,sub,hi}){
  return(
    <div style={{background:C.card,border:`1px solid ${hi?hi+"3D":C.borderSoft}`,borderRadius:11,padding:"12px 13px",textAlign:"center"}}>
      <div style={{fontSize:9.5,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:4,fontWeight:600}}>{label}</div>
      <div style={{fontSize:18.5,fontWeight:700,color:hi||C.text,fontFamily:"var(--font-mono)",letterSpacing:"-0.3px"}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{sub}</div>}
    </div>
  );
}

function Sig({t,text}){
  const col=t==="ok"?C.green:t==="warn"?C.yellow:C.red;
  const icon=t==="ok"?"check":t==="warn"?"alert":"x";
  return(
    <div style={{display:"flex",gap:10,padding:"9px 0",borderBottom:`1px solid ${C.borderSoft}`,alignItems:"flex-start"}}>
      <span style={{color:col,marginTop:1}}><Icon name={icon} size={14}/></span>
      <span style={{fontSize:12.5,color:C.text,lineHeight:1.5}}>{text}</span>
    </div>
  );
}

function Btn({onClick,children,variant="primary",style={}}){
  const base={border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",padding:"9.5px 16px",...style};
  const v={
    primary:{background:"linear-gradient(135deg, #5B8DEF 0%, #4C7FE0 100%)",color:"#fff",boxShadow:"0 2px 10px rgba(91,141,239,0.3)"},
    secondary:{background:C.input,color:C.text,border:`1px solid ${C.border}`},
    success:{background:C.green+"1A",color:C.green,border:`1px solid ${C.green}40`},
    danger:{background:C.red+"1A",color:C.red,border:`1px solid ${C.red}40`}
  };
  return <button className="op-btn" onClick={onClick} style={{...base,...v[variant]}}>{children}</button>;
}

function Badge({color,children}){
  return <span style={{background:color+"1F",color,border:`1px solid ${color}44`,borderRadius:20,fontSize:10,padding:"3px 9px",fontWeight:700,letterSpacing:"0.2px"}}>{children}</span>;
}

function ExtLink({href,children}){
  return(
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      fontSize:10,color:C.accent,textDecoration:"none",
      background:C.accent+"14",border:`1px solid ${C.accent}33`,
      borderRadius:5,padding:"2px 7px",whiteSpace:"nowrap",
      display:"inline-flex",alignItems:"center",gap:4
    }}>
      <Icon name="external" size={10}/> {children}
    </a>
  );
}

function EmptyState({icon,title,desc}){
  return(
    <Card style={{padding:"56px 40px",textAlign:"center"}}>
      <div style={{width:52,height:52,borderRadius:14,background:C.input,border:`1px solid ${C.border}`,
        display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",color:C.accent}}>
        <Icon name={icon} size={24}/>
      </div>
      <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>{title}</div>
      <div style={{fontSize:12.5,color:C.muted,maxWidth:380,margin:"0 auto",lineHeight:1.5}}>{desc}</div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════
// SHARED ATIVO FETCHER
// ════════════════════════════════════════════════════════════════════
function AtivoFetcher({ativo,onAtivo,preco,onPreco,histVol,onHistVol,taxa,onTaxa,tipo,onTipo,extra}){
  const [status,setStatus]=useState("idle");

  const buscar=useCallback(async(tick)=>{
    if(!tick||tick.length<4) return;
    setStatus("loading");
    try{
      const {price,prices}=await fetchAtivo(tick);
      if(price){onPreco(String(price));setStatus("ok");}else{setStatus("error");}
      if(prices&&prices.length>10){const hv=calcHistVol(prices);if(hv)onHistVol(hv.toFixed(1));}
    }catch{setStatus("error");}
  },[]);

  useEffect(()=>{
    if(!ativo||ativo.length<4) return;
    const t=setTimeout(()=>buscar(ativo),800);
    return()=>clearTimeout(t);
  },[ativo]);

  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <Fld label="Ativo">
          <input className="op-input" value={ativo} onChange={e=>{onAtivo(e.target.value.toUpperCase());setStatus("idle");}}
            placeholder="PETR4" style={iS()}/>
        </Fld>
        <Fld label="Tipo">
          <select className="op-select" value={tipo} onChange={e=>onTipo(e.target.value)} style={iS()}>
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </Fld>
      </div>
      <Fld label="Preço atual" hint={status==="ok"?`R$ ${preco} — Brapi`:status==="error"?"Não encontrado — digite manualmente":"Buscado automaticamente"}>
        <div style={{display:"flex",gap:6}}>
          <div style={{position:"relative",flex:1}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>R$</span>
            <input className="op-input" type="number" value={preco} onChange={e=>onPreco(e.target.value)}
              placeholder="automático" style={iS({paddingLeft:26})}/>
          </div>
          <Btn onClick={()=>buscar(ativo)} variant="secondary" style={{padding:"0 12px",minWidth:44,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {status==="loading"?<Icon name="refresh" size={15} style={{color:C.muted,animation:"spin 0.9s linear infinite"}}/>
              :status==="ok"?<Icon name="check" size={15} style={{color:C.green}}/>
              :status==="error"?<Icon name="x" size={15} style={{color:C.red}}/>
              :<Icon name="refresh" size={15} style={{color:C.muted}}/>}
          </Btn>
        </div>
      </Fld>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <Fld label="Vol. histórica (auto)" hint="Calculada dos últimos 3 meses via Brapi">
          <div style={{position:"relative"}}>
            <input className="op-input" type="number" value={histVol} onChange={e=>onHistVol(e.target.value)}
              placeholder="calculando..." style={iS({paddingRight:22,background:C.green+"0D",border:`1px solid ${C.green}33`})}/>
            <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>%</span>
          </div>
        </Fld>
        <Fld label="Selic anual" hint="14% = 0.1400">
          <input className="op-input" type="number" value={taxa} onChange={e=>onTaxa(e.target.value)}
            placeholder="0.1400" style={iS({border:`1px solid ${C.accent}44`,background:C.accent+"0D"})}/>
        </Fld>
      </div>
      {extra}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ABA 1 — ANALISAR
// ════════════════════════════════════════════════════════════════════
function TabAnalisar(){
  const defaultVenc=getNextExpiry();
  const [ativo,setAtivo]=useState("PETR4");
  const [tipo,setTipo]=useState("call");
  const [preco,setPreco]=useState("");
  const [histVol,setHistVol]=useState("");
  const [taxa,setTaxa]=useState("0.1400");
  const [strike,setStrike]=useState("");
  const [premio,setPremio]=useState("");
  const [dataVenc,setDataVenc]=useState(defaultVenc);
  const [qtd,setQtd]=useState("100");
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);

  const dias=diasAte(dataVenc);

  const calcular=()=>{
    setLoading(true);
    setTimeout(()=>{
      const S=parseFloat(preco),K=parseFloat(strike),pv=parseFloat(premio);
      const hv=parseFloat(histVol)/100,r=parseFloat(taxa),q=parseInt(qtd),T=dias/365;
      if(!S||!K||!pv||!dias||!hv){alert("Preencha todos os campos.");setLoading(false);return;}
      const iv=impliedVol({S,K,T,r,marketPrice:pv,type:tipo});
      if(!iv){alert("Não foi possível calcular IV.");setLoading(false);return;}
      const g=bs({S,K,T,r,sigma:iv,type:tipo});
      const pp=(pv/S)*100;
      const noc=tipo==="call"?S*q:K*q;
      const rn=(pv*q/noc)*100;
      const peq=tipo==="call"?K+pv:K-pv;
      const dec=decide({iv:iv*100,ivHist:hv*100,delta:g.delta,premioPercent:pp,dias,taxa:r});
      setResult({iv:iv*100,g,pp,noc,rn,peq,dec,q,pv,S,K,tipo,dias,taxa:r,hv:hv*100});
      setLoading(false);
    },200);
  };

  const vc=result?result.dec.color:null;

  return(
    <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:20,alignItems:"start"}}>
      <Card>
        <SectionTitle>Dados da Operação</SectionTitle>
        <AtivoFetcher ativo={ativo} onAtivo={setAtivo} preco={preco} onPreco={setPreco}
          histVol={histVol} onHistVol={setHistVol} taxa={taxa} onTaxa={setTaxa}
          tipo={tipo} onTipo={setTipo}
          extra={
            <div>
              <Fld label="Strike">
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>R$</span>
                  <input className="op-input" type="number" value={strike} onChange={e=>setStrike(e.target.value)} placeholder="45.05" style={iS({paddingLeft:26})}/>
                </div>
              </Fld>
              <Fld label="Prêmio atual — bid no Profit">
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>R$</span>
                  <input className="op-input" type="number" value={premio} onChange={e=>setPremio(e.target.value)} placeholder="1.44" style={iS({paddingLeft:26})}/>
                </div>
              </Fld>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Fld label="Vencimento" hint={dias>0?`${dias} dias`:""}>
                  <input className="op-input" type="date" value={dataVenc} onChange={e=>setDataVenc(e.target.value)} style={iS()}/>
                </Fld>
                <Fld label="Quantidade">
                  <input className="op-input" type="number" value={qtd} onChange={e=>setQtd(e.target.value)} placeholder="100" style={iS()}/>
                </Fld>
              </div>
            </div>
          }/>
        <Btn onClick={calcular} style={{width:"100%",marginTop:8}} variant={loading?"secondary":"primary"}>
          {loading?"Calculando...":"Analisar →"}
        </Btn>
        <Btn onClick={()=>{setAtivo("PETR4");setTipo("call");setStrike("45.05");setPremio("1.44");
          setDataVenc(defaultVenc);setQtd("100");setPreco("41.81");setHistVol("27");setResult(null);}}
          variant="secondary" style={{width:"100%",marginTop:6}}>
          Carregar exemplo PETR4
        </Btn>
      </Card>

      <div>
        {!result?(
          <EmptyState icon="zap" title="Preencha os dados ao lado"
            desc="Vol. histórica calculada automaticamente · IV via Black-Scholes · Comparação vs Selic do período"/>
        ):(
          <>
            {/* Verdict */}
            <div style={{background:vc+"12",border:`1px solid ${vc}44`,borderRadius:14,padding:"16px 20px",
              marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",
              boxShadow:`0 8px 24px ${vc}14`}}>
              <div>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>Decisão</div>
                <div style={{fontSize:25,fontWeight:800,color:vc,letterSpacing:"-0.3px"}}>{result.dec.verdict}</div>
              </div>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{textAlign:"center",padding:"7px 14px",background:C.input,borderRadius:10,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.muted,fontWeight:600}}>SELIC {result.dias}d</div>
                  <div style={{fontSize:15,fontWeight:700,color:C.muted,fontFamily:"var(--font-mono)"}}>{result.dec.sp.toFixed(2)}%</div>
                </div>
                <div style={{textAlign:"center",padding:"7px 14px",background:vc+"14",borderRadius:10,border:`1px solid ${vc}44`}}>
                  <div style={{fontSize:9,color:C.muted,fontWeight:600}}>PRÊMIO</div>
                  <div style={{fontSize:15,fontWeight:700,color:vc,fontFamily:"var(--font-mono)"}}>{result.pp.toFixed(2)}%</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,color:C.muted,fontWeight:600}}>Score</div>
                  <div style={{fontSize:27,fontWeight:800,color:vc,fontFamily:"var(--font-mono)"}}>{result.dec.score>0?"+":""}{result.dec.score}</div>
                </div>
              </div>
            </div>

            {/* Gregas */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:10}}>
              <Metric label="IV Atual" value={`${result.iv.toFixed(1)}%`}
                sub={`Hist: ${result.hv.toFixed(0)}% · +${(result.iv-result.hv).toFixed(1)}p`}
                hi={result.iv>result.hv+8?C.green:result.iv<result.hv?C.red:C.yellow}/>
              <Metric label="Delta" value={(result.g.delta*100).toFixed(1)}
                hi={Math.abs(result.g.delta)>=0.25&&Math.abs(result.g.delta)<=0.35?C.green:Math.abs(result.g.delta)>0.45?C.red:C.yellow}/>
              <Metric label="Prob. OTM" value={`${result.g.probOTM.toFixed(0)}%`}
                sub="chance de embolsar tudo"
                hi={result.g.probOTM>=70?C.green:result.g.probOTM>=55?C.yellow:C.red}/>
              <Metric label="Theta /dia" value={`R$ ${Math.abs(result.g.theta*result.q).toFixed(2)}`}
                sub="decay a seu favor" hi={C.green}/>
              <Metric label="Ponto Equil." value={`R$ ${result.peq.toFixed(2)}`}
                sub={result.tipo==="call"?"ativo pode subir até":"ativo pode cair até"}/>
            </div>

            {/* Financeiro */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
              <Metric label="Prêmio Total" value={`R$ ${(result.pv*result.q).toFixed(2)}`} sub={`${result.pp.toFixed(2)}% do ativo`}/>
              <Metric label="Retorno s/ Nocional" value={`${result.rn.toFixed(2)}%`}
                sub={`Nocional R$ ${result.noc.toFixed(0)}`}
                hi={result.rn>=result.dec.sp*1.5?C.green:result.rn>=result.dec.sp?C.yellow:C.red}/>
              <Metric label="Vega /1% IV" value={`R$ ${(result.g.vega*result.q).toFixed(2)}`} sub="sensibilidade à vol"/>
            </div>

            {/* Gestão */}
            <Card style={{marginBottom:10}}>
              <SectionTitle>Gestão da Posição</SectionTitle>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {[{l:"ALVO 75%",v:result.pv*0.25,c:C.green,s:"recompra aqui"},
                  {l:"ALVO 50%",v:result.pv*0.5,c:C.yellow,s:"recompra aqui"},
                  {l:"STOP 2×",v:result.pv*2,c:C.red,s:"encerra prejuízo"}].map(({l,v,c,s})=>(
                  <div key={l} style={{background:C.input,borderRadius:10,padding:12,textAlign:"center",border:`1px solid ${C.borderSoft}`}}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:3,fontWeight:600}}>{l}</div>
                    <div style={{fontSize:16,fontWeight:700,color:c,fontFamily:"var(--font-mono)"}}>R$ {v.toFixed(2)}</div>
                    <div style={{fontSize:10,color:C.muted}}>{s}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Sinais */}
            <Card>
              <SectionTitle>Análise dos Critérios</SectionTitle>
              {result.dec.signals.map((s,i)=><Sig key={i} {...s}/>)}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ABA 2 — COMPARAR STRIKES
// ════════════════════════════════════════════════════════════════════
function TabComparar(){
  const defaultVenc=getNextExpiry();
  const [ativo,setAtivo]=useState("PETR4");
  const [tipo,setTipo]=useState("call");
  const [preco,setPreco]=useState("");
  const [histVol,setHistVol]=useState("");
  const [taxa,setTaxa]=useState("0.1400");
  const [dataVenc,setDataVenc]=useState(defaultVenc);
  const [qtd,setQtd]=useState("100");
  const [strikes,setStrikes]=useState(["","","",""]);
  const [premios,setPremios]=useState(["","","",""]);
  const [results,setResults]=useState([]);

  const dias=diasAte(dataVenc);

  const calcular=()=>{
    const S=parseFloat(preco),hv=parseFloat(histVol)/100,r=parseFloat(taxa),q=parseInt(qtd),T=dias/365;
    if(!S||!hv||!dias){alert("Preencha ativo, preço, vol histórica e vencimento.");return;}
    const res=[];
    for(let i=0;i<4;i++){
      const K=parseFloat(strikes[i]),pv=parseFloat(premios[i]);
      if(!K||!pv) continue;
      const iv=impliedVol({S,K,T,r,marketPrice:pv,type:tipo});
      if(!iv) continue;
      const g=bs({S,K,T,r,sigma:iv,type:tipo});
      const pp=(pv/S)*100;
      const noc=tipo==="call"?S*q:K*q;
      const rn=(pv*q/noc)*100;
      const peq=tipo==="call"?K+pv:K-pv;
      const sp=selicPeriodo(r,dias);
      const dec=decide({iv:iv*100,ivHist:hv*100,delta:g.delta,premioPercent:pp,dias,taxa:r});
      res.push({K,pv,iv:iv*100,g,pp,rn,peq,sp,dec,q,noc});
    }
    setResults(res);
  };

  const cols=["STRIKE","PRÊMIO","IV","DELTA","PROB. OTM","THETA /dia","RETORNO %","vs SELIC","P. EQUIL.","DECISÃO"];

  return(
    <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:20,alignItems:"start"}}>
      <Card>
        <SectionTitle>Configuração</SectionTitle>
        <AtivoFetcher ativo={ativo} onAtivo={setAtivo} preco={preco} onPreco={setPreco}
          histVol={histVol} onHistVol={setHistVol} taxa={taxa} onTaxa={setTaxa}
          tipo={tipo} onTipo={setTipo}
          extra={
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Fld label="Vencimento" hint={dias>0?`${dias} dias`:""}>
                  <input className="op-input" type="date" value={dataVenc} onChange={e=>setDataVenc(e.target.value)} style={iS()}/>
                </Fld>
                <Fld label="Quantidade">
                  <input className="op-input" type="number" value={qtd} onChange={e=>setQtd(e.target.value)} placeholder="100" style={iS()}/>
                </Fld>
              </div>
              <SectionTitle>Strikes para comparar</SectionTitle>
              {[0,1,2,3].map(i=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:11}}>K</span>
                    <input className="op-input" type="number" value={strikes[i]} placeholder={`Strike ${i+1}`}
                      onChange={e=>{const s=[...strikes];s[i]=e.target.value;setStrikes(s);}}
                      style={iS({paddingLeft:20,fontSize:12})}/>
                  </div>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:11}}>R$</span>
                    <input className="op-input" type="number" value={premios[i]} placeholder="Prêmio"
                      onChange={e=>{const p=[...premios];p[i]=e.target.value;setPremios(p);}}
                      style={iS({paddingLeft:20,fontSize:12})}/>
                  </div>
                </div>
              ))}
            </div>
          }/>
        <Btn onClick={calcular} style={{width:"100%",marginTop:8}}>Comparar →</Btn>
      </Card>

      <div>
        {results.length===0?(
          <EmptyState icon="bars" title="Compare até 4 strikes"
            desc="Preencha os strikes e prêmios ao lado — o sistema calcula tudo e mostra o melhor"/>
        ):(
          <Card style={{overflowX:"auto"}}>
            <SectionTitle>Comparativo de Strikes</SectionTitle>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr>
                  {cols.map(c=>(
                    <th key={c} style={{padding:"9px 10px",background:C.input,color:C.muted,
                      textAlign:"center",fontSize:10,textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:700,
                      border:`1px solid ${C.borderSoft}`}}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r,i)=>{
                  const adelta=Math.abs(r.g.delta);
                  const deltaCol=adelta>=0.25&&adelta<=0.35?C.green:adelta>0.45?C.red:C.yellow;
                  const rnCol=r.rn>=r.sp*1.5?C.green:r.rn>=r.sp?C.yellow:C.red;
                  return(
                    <tr key={i} style={{background:i%2===0?C.card:"#151a26"}}>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:700,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {r.K.toFixed(2)}</td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {r.pv.toFixed(2)}</td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontFamily:"var(--font-mono)",
                        color:r.iv>parseFloat(histVol)+8?C.green:r.iv<parseFloat(histVol)?C.red:C.yellow,fontWeight:600}}>
                        {r.iv.toFixed(1)}%
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:deltaCol,fontWeight:600,fontFamily:"var(--font-mono)"}}>
                        {(r.g.delta*100).toFixed(1)}
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontFamily:"var(--font-mono)",
                        color:r.g.probOTM>=70?C.green:r.g.probOTM>=55?C.yellow:C.red,fontWeight:600}}>
                        {r.g.probOTM.toFixed(0)}%
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.green,fontFamily:"var(--font-mono)"}}>
                        R$ {Math.abs(r.g.theta*r.q).toFixed(2)}
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:rnCol,fontWeight:700,fontFamily:"var(--font-mono)"}}>
                        {r.rn.toFixed(2)}%
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontFamily:"var(--font-mono)",
                        color:r.rn>=r.sp*1.5?C.green:r.rn>=r.sp?C.yellow:C.red}}>
                        {(r.rn/r.sp).toFixed(1)}×
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted,fontFamily:"var(--font-mono)"}}>
                        R$ {r.peq.toFixed(2)}
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.borderSoft}`}}>
                        <Badge color={r.dec.color}>{r.dec.verdict}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{marginTop:12,fontSize:11,color:C.muted}}>
              Verde = ideal · Amarelo = atenção · Vermelho = cuidado · "vs Selic" = múltiplo do CDI equivalente no período
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ABA 3 — POSIÇÕES ABERTAS
// ════════════════════════════════════════════════════════════════════
function TabPosicoes(){
  const [posicoes,setPosicoes]=useState([]);
  const [form,setForm]=useState({ativo:"",tipo:"call",strike:"",premio:"",qtd:"100",dataVenc:getNextExpiry(),precoEntrada:""});
  const [showForm,setShowForm]=useState(false);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem("op_posicoes")||"[]");
      setPosicoes(saved);
    }catch{}
    setLoaded(true);
  },[]);

  useEffect(()=>{
    if(!loaded) return;
    localStorage.setItem("op_posicoes",JSON.stringify(posicoes));
  },[posicoes,loaded]);

  const setF=(k,v)=>setForm(f=>({...f,[k]:v}));

  const adicionar=()=>{
    if(!form.ativo||!form.strike||!form.premio||!form.precoEntrada){alert("Preencha todos os campos.");return;}
    const nova={
      id:Date.now(), ativo:form.ativo.toUpperCase(), tipo:form.tipo,
      strike:parseFloat(form.strike), premio:parseFloat(form.premio),
      qtd:parseInt(form.qtd), dataVenc:form.dataVenc,
      precoEntrada:parseFloat(form.precoEntrada),
      dataAbertura:new Date().toISOString().split("T")[0]
    };
    setPosicoes(p=>[...p,nova]);
    setForm({ativo:"",tipo:"call",strike:"",premio:"",qtd:"100",dataVenc:getNextExpiry(),precoEntrada:""});
    setShowForm(false);
  };

  const remover=(id)=>setPosicoes(p=>p.filter(x=>x.id!==id));

  const totalNocional=posicoes.reduce((acc,p)=>acc+(p.tipo==="call"?p.precoEntrada*p.qtd:p.strike*p.qtd),0);
  const totalPremio=posicoes.reduce((acc,p)=>acc+p.premio*p.qtd,0);

  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>Posições Abertas</div>
          <div style={{fontSize:12,color:C.muted}}>
            {posicoes.length} posição(ões) · Nocional total: <span style={{color:C.accent,fontFamily:"var(--font-mono)"}}>R$ {totalNocional.toFixed(0)}</span> · Prêmio recebido: <span style={{color:C.green,fontFamily:"var(--font-mono)"}}>R$ {totalPremio.toFixed(2)}</span>
          </div>
        </div>
        <Btn onClick={()=>setShowForm(!showForm)} variant={showForm?"secondary":"primary"}>
          {showForm?"Cancelar":"+ Adicionar Posição"}
        </Btn>
      </div>

      {/* Form */}
      {showForm&&(
        <Card style={{marginBottom:16}}>
          <SectionTitle>Nova Posição</SectionTitle>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            <Fld label="Ativo"><input className="op-input" value={form.ativo} onChange={e=>setF("ativo",e.target.value.toUpperCase())} placeholder="PETR4" style={iS()}/></Fld>
            <Fld label="Tipo">
              <select className="op-select" value={form.tipo} onChange={e=>setF("tipo",e.target.value)} style={iS()}>
                <option value="call">Call Coberta</option>
                <option value="put">Put Vendida</option>
              </select>
            </Fld>
            <Fld label="Strike"><input className="op-input" type="number" value={form.strike} onChange={e=>setF("strike",e.target.value)} placeholder="45.05" style={iS()}/></Fld>
            <Fld label="Prêmio recebido/ação"><input className="op-input" type="number" value={form.premio} onChange={e=>setF("premio",e.target.value)} placeholder="1.44" style={iS()}/></Fld>
            <Fld label="Quantidade"><input className="op-input" type="number" value={form.qtd} onChange={e=>setF("qtd",e.target.value)} placeholder="100" style={iS()}/></Fld>
            <Fld label="Vencimento"><input className="op-input" type="date" value={form.dataVenc} onChange={e=>setF("dataVenc",e.target.value)} style={iS()}/></Fld>
            <Fld label="Preço de entrada do ativo"><input className="op-input" type="number" value={form.precoEntrada} onChange={e=>setF("precoEntrada",e.target.value)} placeholder="41.81" style={iS()}/></Fld>
            <Fld label=""><div style={{paddingTop:18}}><Btn onClick={adicionar} style={{width:"100%"}}>Adicionar</Btn></div></Fld>
          </div>
        </Card>
      )}

      {/* Lista */}
      {posicoes.length===0?(
        <EmptyState icon="clipboard" title="Nenhuma posição aberta"
          desc='Clique em "+ Adicionar Posição" para registrar seus lançamentos'/>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {posicoes.map(p=>{
            const dias=diasAte(p.dataVenc);
            const alerta=dias<=5;
            const noc=p.tipo==="call"?p.precoEntrada*p.qtd:p.strike*p.qtd;
            const premioTotal=p.premio*p.qtd;
            const retorno=(premioTotal/noc)*100;
            return(
              <Card key={p.id} style={{border:`1px solid ${alerta?C.red+"44":C.borderSoft}`}}>
                <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                  <div style={{minWidth:80}}>
                    <div style={{fontSize:16,fontWeight:700,color:C.text}}>{p.ativo}</div>
                    <Badge color={p.tipo==="call"?C.accent:"#A78BFA"}>{p.tipo==="call"?"Call":"Put"}</Badge>
                  </div>
                  <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>STRIKE</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {p.strike.toFixed(2)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>QTD. OPÇÕES</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>{p.qtd}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>PRÊMIO/OPÇÃO</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.green,fontFamily:"var(--font-mono)"}}>R$ {p.premio.toFixed(2)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>NOCIONAL</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {noc.toFixed(0)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>RETORNO</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.yellow,fontFamily:"var(--font-mono)"}}>{retorno.toFixed(2)}%</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>VENCIMENTO</div>
                      <div style={{fontSize:14,fontWeight:600,color:alerta?C.red:dias<=10?C.yellow:C.text,fontFamily:"var(--font-mono)",
                        display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                        {dias}d {alerta&&<Icon name="alert" size={12}/>}
                      </div>
                      <div style={{fontSize:10,color:C.muted}}>{p.dataVenc}</div>
                    </div>
                  </div>
                  <Btn onClick={()=>remover(p.id)} variant="danger" style={{padding:"6px 12px",fontSize:11}}>Remover</Btn>
                </div>
                {alerta&&(
                  <div style={{marginTop:10,padding:"8px 10px",background:C.red+"0F",borderRadius:8,fontSize:11,color:C.red,
                    display:"flex",alignItems:"center",gap:6}}>
                    <Icon name="alert" size={13}/> Vence em {dias} dia(s) — decida: fechar, rolar ou deixar expirar
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ABA 4 — SIMULADOR DE ROLAGEM
// ════════════════════════════════════════════════════════════════════
function TabRolagem(){
  const defaultVenc=getNextExpiry();
  const [ativo,setAtivo]=useState("PETR4");
  const [tipo,setTipo]=useState("call");
  const [preco,setPreco]=useState("");
  const [histVol,setHistVol]=useState("");
  const [taxa,setTaxa]=useState("0.1400");
  const [strikeAtual,setStrikeAtual]=useState("");
  const [premioOriginal,setPremioOriginal]=useState("");
  const [premioRecompra,setPremioRecompra]=useState("");
  const [novoStrike,setNovoStrike]=useState("");
  const [novosPremios,setNovosPremios]=useState(["","",""]);
  const [novasVenc,setNovasVenc]=useState([defaultVenc,defaultVenc,defaultVenc]);
  const [qtd,setQtd]=useState("100");
  const [result,setResult]=useState(null);

  const dias0=diasAte(novasVenc[0]);
  const dias1=diasAte(novasVenc[1]);
  const dias2=diasAte(novasVenc[2]);

  const calcular=()=>{
    const S=parseFloat(preco),hv=parseFloat(histVol)/100,r=parseFloat(taxa);
    const K0=parseFloat(strikeAtual),p0=parseFloat(premioOriginal),pr=parseFloat(premioRecompra);
    const KN=parseFloat(novoStrike),q=parseInt(qtd);
    if(!S||!hv||!K0||!p0||!pr||!KN){alert("Preencha todos os campos.");return;}

    const custRecompra=pr*q;
    const premioRecebidoOriginal=p0*q;
    const lucroJaCapturado=premioRecebidoOriginal-custRecompra;

    const opcoes=[];
    for(let i=0;i<3;i++){
      const pN=parseFloat(novosPremios[i]);
      const dias=i===0?dias0:i===1?dias1:dias2;
      if(!pN||!dias) continue;
      const T=dias/365;
      const ivN=impliedVol({S,K:KN,T,r,marketPrice:pN,type:tipo});
      if(!ivN) continue;
      const gN=bs({S,K:KN,T,r,sigma:ivN,type:tipo});
      const creditoLiq=pN*q-custRecompra;
      const noc=tipo==="call"?S*q:KN*q;
      const retorno=(creditoLiq/noc)*100;
      const sp=selicPeriodo(r,dias);
      opcoes.push({venc:novasVenc[i],dias,pN,ivN:ivN*100,delta:gN.delta,probOTM:gN.probOTM,
                   creditoLiq,retorno,sp,noc,theta:gN.theta});
    }

    setResult({custRecompra,lucroJaCapturado,premioRecebidoOriginal,opcoes,q,K0,KN,p0,pr,S});
  };

  return(
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20,alignItems:"start"}}>
      <Card>
        <SectionTitle>Posição Atual</SectionTitle>
        <AtivoFetcher ativo={ativo} onAtivo={setAtivo} preco={preco} onPreco={setPreco}
          histVol={histVol} onHistVol={setHistVol} taxa={taxa} onTaxa={setTaxa}
          tipo={tipo} onTipo={setTipo}
          extra={
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Fld label="Strike atual">
                  <input className="op-input" type="number" value={strikeAtual} onChange={e=>setStrikeAtual(e.target.value)} placeholder="45.05" style={iS()}/>
                </Fld>
                <Fld label="Prêmio original">
                  <input className="op-input" type="number" value={premioOriginal} onChange={e=>setPremioOriginal(e.target.value)} placeholder="1.44" style={iS()}/>
                </Fld>
              </div>
              <Fld label="Custo recompra atual" hint="Prêmio atual no mercado para fechar">
                <input className="op-input" type="number" value={premioRecompra} onChange={e=>setPremioRecompra(e.target.value)} placeholder="0.36" style={iS()}/>
              </Fld>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Fld label="Novo strike">
                  <input className="op-input" type="number" value={novoStrike} onChange={e=>setNovoStrike(e.target.value)} placeholder="46.00" style={iS()}/>
                </Fld>
                <Fld label="Quantidade">
                  <input className="op-input" type="number" value={qtd} onChange={e=>setQtd(e.target.value)} placeholder="100" style={iS()}/>
                </Fld>
              </div>
              <SectionTitle>Opções de Rolagem</SectionTitle>
              {[0,1,2].map(i=>(
                <div key={i} style={{marginBottom:8}}>
                  <div style={{fontSize:10,color:C.muted,marginBottom:4,fontWeight:600}}>OPÇÃO {i+1}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                    <input className="op-input" type="date" value={novasVenc[i]}
                      onChange={e=>{const v=[...novasVenc];v[i]=e.target.value;setNovasVenc(v);}} style={iS({fontSize:12})}/>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:11}}>R$</span>
                      <input className="op-input" type="number" value={novosPremios[i]} placeholder="novo prêmio"
                        onChange={e=>{const p=[...novosPremios];p[i]=e.target.value;setNovosPremios(p);}} style={iS({paddingLeft:20,fontSize:12})}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          }/>
        <Btn onClick={calcular} style={{width:"100%",marginTop:8}}>Simular Rolagem →</Btn>
      </Card>

      <div>
        {!result?(
          <EmptyState icon="refresh" title="Simule sua rolagem"
            desc="Preencha a posição atual e até 3 opções de rolagem — o sistema calcula qual compensa mais"/>
        ):(
          <>
            <Card style={{marginBottom:12}}>
              <SectionTitle>Resumo da Posição Atual</SectionTitle>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                <Metric label="Prêmio Original" value={`R$ ${result.premioRecebidoOriginal.toFixed(2)}`} hi={C.green}/>
                <Metric label="Custo Recompra" value={`R$ ${result.custRecompra.toFixed(2)}`} hi={C.red}/>
                <Metric label="Lucro já capturado" value={`R$ ${result.lucroJaCapturado.toFixed(2)}`}
                  sub={`${(result.lucroJaCapturado/result.premioRecebidoOriginal*100).toFixed(0)}% do prêmio`}
                  hi={result.lucroJaCapturado>0?C.green:C.red}/>
              </div>
            </Card>

            <Card>
              <SectionTitle>Comparativo de Rolagens</SectionTitle>
              {result.opcoes.length===0?(
                <div style={{textAlign:"center",padding:30,color:C.muted}}>Preencha pelo menos uma opção de rolagem</div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {result.opcoes.map((o,i)=>{
                    const vale=o.creditoLiq>0&&o.retorno>=o.sp;
                    return(
                      <div key={i} style={{background:vale?C.green+"08":C.red+"08",
                        border:`1px solid ${vale?C.green+"40":C.red+"2E"}`,borderRadius:12,padding:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <div style={{fontWeight:700,color:C.text}}>Opção {i+1} — {o.venc} ({o.dias} dias)</div>
                          <Badge color={vale?C.green:C.red}>{vale?"VALE ROLAR":"NÃO VALE"}</Badge>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
                          <Metric label="Crédito líq." value={`R$ ${o.creditoLiq.toFixed(2)}`} hi={o.creditoLiq>0?C.green:C.red}/>
                          <Metric label="Retorno" value={`${o.retorno.toFixed(2)}%`}
                            hi={o.retorno>=o.sp*1.5?C.green:o.retorno>=o.sp?C.yellow:C.red}/>
                          <Metric label="vs Selic" value={`${(o.retorno/o.sp).toFixed(1)}×`}
                            sub={`Selic: ${o.sp.toFixed(2)}%`}
                            hi={o.retorno>=o.sp?C.green:C.red}/>
                          <Metric label="Delta novo" value={(o.delta*100).toFixed(1)}
                            hi={Math.abs(o.delta)>=0.25&&Math.abs(o.delta)<=0.35?C.green:C.yellow}/>
                          <Metric label="Prob. OTM" value={`${o.probOTM.toFixed(0)}%`}
                            hi={o.probOTM>=70?C.green:C.yellow}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ABA 5 — PERFORMANCE
// ════════════════════════════════════════════════════════════════════
function TabPerformance(){
  const [ops,setOps]=useState([]);
  const [form,setForm]=useState({mes:"",resultado:"",meta:"2000",selic:"0.1400"});
  const [showForm,setShowForm]=useState(false);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem("op_performance")||"[]");
      setOps(saved);
    }catch{}
    setLoaded(true);
  },[]);

  useEffect(()=>{
    if(!loaded) return;
    localStorage.setItem("op_performance",JSON.stringify(ops));
  },[ops,loaded]);

  const setF=(k,v)=>setForm(f=>({...f,[k]:v}));

  const meses=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const ano=new Date().getFullYear();

  const adicionar=()=>{
    if(!form.mes||!form.resultado){alert("Preencha mês e resultado.");return;}
    setOps(o=>[...o.filter(x=>x.mes!==form.mes),{mes:form.mes,resultado:parseFloat(form.resultado),meta:parseFloat(form.meta),selic:parseFloat(form.selic)}]);
    setShowForm(false);
  };

  // Gera todos os 12 meses
  const data=meses.map((m,i)=>{
    const op=ops.find(o=>o.mes===m);
    const selicMes=op?((Math.pow(1+op.selic,1/12)-1)*100).toFixed(2):((Math.pow(1.14,1/12)-1)*100).toFixed(2);
    return{mes:m,resultado:op?.resultado??null,meta:op?.meta??2000,selicMes:parseFloat(selicMes),hasData:!!op};
  });

  const totalRes=data.reduce((a,d)=>a+(d.resultado??0),0);
  const totalSelic=data.reduce((a,d)=>a+d.selicMes,0);
  const mesesComDados=data.filter(d=>d.hasData);
  const acertos=mesesComDados.filter(d=>d.resultado>=d.meta).length;

  // Mini bar chart
  const maxVal=Math.max(...data.map(d=>Math.abs(d.resultado??0)),1);

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>Performance {ano}</div>
          <div style={{fontSize:12,color:C.muted}}>Resultado acumulado vs Selic</div>
        </div>
        <Btn onClick={()=>setShowForm(!showForm)} variant={showForm?"secondary":"primary"}>
          {showForm?"Cancelar":"+ Lançar Resultado"}
        </Btn>
      </div>

      {showForm&&(
        <Card style={{marginBottom:16}}>
          <SectionTitle>Lançar Resultado do Mês</SectionTitle>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            <Fld label="Mês">
              <select className="op-select" value={form.mes} onChange={e=>setF("mes",e.target.value)} style={iS()}>
                <option value="">Selecione</option>
                {meses.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            </Fld>
            <Fld label="Resultado líq. (R$)">
              <input className="op-input" type="number" value={form.resultado} onChange={e=>setF("resultado",e.target.value)} placeholder="267.76" style={iS()}/>
            </Fld>
            <Fld label="Meta mensal (R$)">
              <input className="op-input" type="number" value={form.meta} onChange={e=>setF("meta",e.target.value)} placeholder="2000" style={iS()}/>
            </Fld>
            <Fld label="">
              <div style={{paddingTop:18}}><Btn onClick={adicionar} style={{width:"100%"}}>Salvar</Btn></div>
            </Fld>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        <Metric label="Resultado Acumulado" value={`R$ ${totalRes.toFixed(2)}`} hi={totalRes>0?C.green:C.red}/>
        <Metric label="Selic Acumulada (est.)" value={`${totalSelic.toFixed(2)}%`} sub="base 14% a.a." hi={C.muted}/>
        <Metric label="Meses c/ Meta Batida" value={`${acertos}/${mesesComDados.length}`}
          hi={acertos===mesesComDados.length&&acertos>0?C.green:acertos>0?C.yellow:C.muted}/>
        <Metric label="Média Mensal" value={mesesComDados.length>0?`R$ ${(totalRes/mesesComDados.length).toFixed(2)}`:"—"}
          hi={mesesComDados.length>0&&totalRes/mesesComDados.length>0?C.green:C.muted}/>
      </div>

      {/* Gráfico de barras */}
      <Card style={{marginBottom:16}}>
        <SectionTitle>Resultado Mensal vs Meta vs Selic</SectionTitle>
        <div style={{display:"flex",gap:4,alignItems:"flex-end",height:120,padding:"0 4px"}}>
          {data.map((d,i)=>{
            const h=d.hasData?Math.abs(d.resultado??0)/maxVal*90:0;
            const col=!d.hasData?C.input:d.resultado>=d.meta?C.green:d.resultado>0?C.yellow:C.red;
            const selicH=(d.selicMes/Math.max(data.reduce((a,x)=>Math.max(a,x.selicMes),0),1))*90;
            return(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:100}}>
                  <div style={{flex:1,background:col,borderRadius:"3px 3px 0 0",height:`${h}px`,minHeight:d.hasData?2:0,transition:"height 0.3s"}}/>
                  <div style={{width:3,background:C.accent+"66",borderRadius:"2px 2px 0 0",height:`${selicH}px`}}/>
                </div>
                <div style={{fontSize:9,color:C.muted}}>{d.mes}</div>
                {d.hasData&&<div style={{fontSize:9,fontWeight:700,color:col,fontFamily:"var(--font-mono)"}}>{d.resultado>=0?"+":""}{d.resultado?.toFixed(0)}</div>}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:16,marginTop:8,fontSize:10,color:C.muted}}>
          <span>■ <span style={{color:C.green}}>Meta batida</span></span>
          <span>■ <span style={{color:C.yellow}}>Positivo</span></span>
          <span>■ <span style={{color:C.red}}>Negativo</span></span>
          <span>▌ <span style={{color:C.accent}}>Selic equiv.</span></span>
        </div>
      </Card>

      {/* Tabela */}
      <Card>
        <SectionTitle>Detalhe por Mês</SectionTitle>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              {["Mês","Resultado (R$)","Meta (R$)","Selic equi.","Bateu Meta?","Múltiplo Selic"].map(h=>(
                <th key={h} style={{padding:"8px 10px",background:C.input,color:C.muted,textAlign:"center",
                  fontSize:10,textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:700,border:`1px solid ${C.borderSoft}`}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d,i)=>(
              <tr key={i} style={{background:i%2===0?C.card:"#151a26"}}>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:600,color:C.text}}>{d.mes}/{ano}</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontFamily:"var(--font-mono)",
                  color:!d.hasData?C.muted:d.resultado>=0?C.green:C.red,fontWeight:d.hasData?700:400}}>
                  {d.hasData?`R$ ${d.resultado?.toFixed(2)}`:"—"}
                </td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted,fontFamily:"var(--font-mono)"}}>R$ {d.meta.toFixed(0)}</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted,fontFamily:"var(--font-mono)"}}>{d.selicMes.toFixed(2)}%</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`}}>
                  {d.hasData?<Badge color={d.resultado>=d.meta?C.green:C.red}>{d.resultado>=d.meta?"SIM":"NÃO"}</Badge>:"—"}
                </td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontFamily:"var(--font-mono)",
                  color:d.hasData&&d.resultado>0?d.resultado/d.selicMes>=1.5?C.green:d.resultado/d.selicMes>=1?C.yellow:C.muted:C.muted}}>
                  {d.hasData&&d.resultado>0?`${(d.resultado/d.selicMes).toFixed(1)}×`:"—"}
                </td>
              </tr>
            ))}
            <tr style={{background:C.accent+"0F"}}>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:700,color:C.text}}>TOTAL</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:700,color:totalRes>=0?C.green:C.red,fontFamily:"var(--font-mono)"}}>R$ {totalRes.toFixed(2)}</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted}}>—</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted,fontFamily:"var(--font-mono)"}}>{totalSelic.toFixed(2)}%</td>
              <td colSpan={2} style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted}}>
                {acertos}/{mesesComDados.length} meses com meta batida
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ABA 6 — PREÇO TETO
// ════════════════════════════════════════════════════════════════════
const SETORES_DB={
  BBAS3:"Banco",ITUB4:"Banco",BBDC4:"Banco",SANB11:"Banco",BRSR6:"Banco",
  EGIE3:"Energia elétrica",TAEE11:"Energia elétrica",ENGI11:"Energia elétrica",
  CPFE3:"Energia elétrica",ENBR3:"Energia elétrica",AURE3:"Energia elétrica",
  CPLE6:"Energia elétrica",TRPL4:"Energia elétrica",EQTL3:"Energia elétrica",
  SAPR11:"Saneamento",CSMG3:"Saneamento",
  VIVT3:"Telecom",TIMS3:"Telecom",
  PETR4:"Petróleo (cíclico)",PETR3:"Petróleo (cíclico)",PRIO3:"Petróleo (cíclico)",
  RECV3:"Petróleo (cíclico)",CSAN3:"Petróleo (cíclico)",
  VALE3:"Mineração (cíclico)",CSNA3:"Siderurgia (cíclico)",GGBR4:"Siderurgia (cíclico)",
  BBSE3:"Seguros",IRBR3:"Seguros",PSSA3:"Seguros",
  ABEV3:"Bebidas",WEGE3:"Máquinas industriais",RENT3:"Locação de veículos",
  VBBR3:"Distribuição combustível",RAIA3:"Farmácia (varejo)",
  MXRF11:"FII - Papel",KNRI11:"FII - Híbrido",HGLG11:"FII - Logística",
  XPLG11:"FII - Logística",BCFF11:"FII - Fundo de fundos",
  CCRO3:"Concessão rodovias",ECOR3:"Concessão rodovias",TGMA3:"Logística",
  SUZB3:"Papel e celulose (cíclico)",KLBN11:"Papel e celulose (cíclico)",
  MGLU3:"Varejo (cíclico)",LREN3:"Varejo (cíclico)",AMER3:"Varejo (cíclico)",
};

const SETORES_CICLICOS=["cíclico","mineração","petróleo","siderurgia","papel","celulose","varejo"];
const isCiclico=(setor)=>setor&&SETORES_CICLICOS.some(s=>setor.toLowerCase().includes(s));

function AutoTag({tipo}){
  const cfg={
    auto:{color:C.green,label:"auto"},
    parcial:{color:C.yellow,label:"parcial"},
    manual:{color:C.muted,label:"manual"},
    calc:{color:C.accent2,label:"calculado"},
  }[tipo]||{color:C.muted,label:"manual"};
  return <span style={{fontSize:9,color:cfg.color,marginLeft:4,fontWeight:700}}>● {cfg.label}</span>;
}

const CHECKLIST=[
  {id:"div5anos",cat:"Dividendos",label:"Paga dividendos há 5+ anos consecutivos?",peso:2,auto:false,
    dica:"Verifique se há proventos em todos os anos recentes no gráfico",
    fonte:(t)=>({label:"Status Invest — Proventos",url:`https://statusinvest.com.br/acoes/${t.toLowerCase()}`})},
  {id:"payoutOk",cat:"Dividendos",label:"Payout sustentável (abaixo de 80%)?",peso:2,auto:true,
    autoLabel:"Calculado automaticamente (Dividendo ÷ EPS)",
    dica:"Payout = quanto do lucro é distribuído. Acima de 100% é insustentável",
    fonte:(t)=>({label:"Status Invest — Resultados",url:`https://statusinvest.com.br/acoes/${t.toLowerCase()}`})},
  {id:"lucroEst",cat:"Fundamentos",label:"Lucro não caiu mais de 20% em nenhum dos últimos 3 anos?",peso:2,auto:false,
    dica:"Veja o gráfico de Lucro Líquido — quedas bruscas indicam instabilidade",
    fonte:(t)=>({label:"Status Invest — Resultados",url:`https://statusinvest.com.br/acoes/${t.toLowerCase()}`})},
  {id:"roeOk",cat:"Fundamentos",label:"ROE acima de 10%?",peso:1,auto:false,
    dica:"ROE = retorno sobre patrimônio. Bancos costumam ter ROE alto (15-20%+)",
    fonte:(t)=>({label:"Status Invest — Indicadores",url:`https://statusinvest.com.br/acoes/${t.toLowerCase()}`})},
  {id:"dividaOk",cat:"Fundamentos",label:"Dívida líquida/EBITDA abaixo de 2,5×?",peso:1,auto:false,
    dica:"Veja 'Dív. Líq./EBITDA' nos indicadores. Utilities (energia, saneamento) aceitam até 3-4×",
    fonte:(t)=>({label:"Status Invest — Indicadores",url:`https://statusinvest.com.br/acoes/${t.toLowerCase()}`})},
  {id:"setorPer",cat:"Qualitativo",label:"Setor perene ou com vantagem competitiva clara?",peso:1,auto:true,
    autoLabel:"Detectado pelo setor do ativo",
    dica:"Energia, banco, saneamento, telecom = perene. Mineração, petróleo, varejo = cíclico",
    fonte:null},
];

function gerarRessalvas({dyAtual,dyMedio,payoutCalc,setor,precoAtual,precoTeto,checklist}){
  const ressalvas=[];
  if(dyAtual&&dyMedio&&parseFloat(dyAtual)>parseFloat(dyMedio)*1.5){
    ressalvas.push({tipo:"warn",texto:`DY atual (${dyAtual}%) está ${(parseFloat(dyAtual)/parseFloat(dyMedio)).toFixed(1)}× acima da média histórica (${dyMedio}%) — pode ser dividendo extraordinário não recorrente`});
  }
  if(isCiclico(setor)){
    ressalvas.push({tipo:"warn",texto:`Setor cíclico (${setor}) — dividendo oscila com o ciclo. Use média de 5+ anos no cálculo, não o último ano`});
  }
  if(payoutCalc&&parseFloat(payoutCalc)>100){
    ressalvas.push({tipo:"bad",texto:`Payout calculado de ${payoutCalc}% — empresa distribuindo mais do que ganha. Dividendo provavelmente insustentável`});
  }
  if(precoAtual&&precoTeto){
    const m=((precoTeto-precoAtual)/precoTeto)*100;
    if(m<10&&m>=0){
      ressalvas.push({tipo:"warn",texto:`Margem de segurança de apenas ${m.toFixed(0)}% — ideal é comprar 15-20% abaixo do teto`});
    }
  }
  ressalvas.push({tipo:"info",texto:"Preço teto = valor MÁXIMO a pagar para atingir o yield desejado. Não garante retorno futuro nem considera crescimento de dividendos"});
  checklist.forEach(item=>{if(item.resposta===false) ressalvas.push({tipo:"bad",texto:item.ressalva||`Critério "${item.label}" não atendido`});});
  return ressalvas;
}

function TabPrecoTeto(){
  const [ticker,setTicker]=useState("PETR4");
  const [fetchStatus,setFetchStatus]=useState("idle");
  const [fetchDivStatus,setFetchDivStatus]=useState("idle");

  const [cotacao,setCotacao]=useState("");
  const [dyAtual,setDyAtual]=useState("");
  const [pl,setPl]=useState("");
  const [eps,setEps]=useState("");
  const [divAnual,setDivAnual]=useState("");
  const [dyMedio,setDyMedio]=useState("");
  const [payoutCalc,setPayoutCalc]=useState("");
  const [setorAuto,setSetorAuto]=useState("");
  const [divHistInfo,setDivHistInfo]=useState(null);

  const [roe,setRoe]=useState("");
  const [dividaEbitda,setDividaEbitda]=useState("");

  const [respostas,setRespostas]=useState({});
  const [expandedDica,setExpandedDica]=useState(null);

  const [yieldMin,setYieldMin]=useState("6");
  const [result,setResult]=useState(null);

  const [ativosDB,setAtivosDB]=useState({});
  const [dbLoaded,setDbLoaded]=useState(false);

  useEffect(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem("op_precoteto_db")||"{}");
      setAtivosDB(saved);
    }catch{}
    setDbLoaded(true);
  },[]);

  useEffect(()=>{
    if(!dbLoaded) return;
    localStorage.setItem("op_precoteto_db",JSON.stringify(ativosDB));
  },[ativosDB,dbLoaded]);

  // Detecta setor automaticamente
  useEffect(()=>{
    const s=SETORES_DB[ticker]||"";
    setSetorAuto(s);
    if(s){
      const perene=!isCiclico(s);
      setRespostas(r=>({...r,setorPer:perene}));
    }else{
      setRespostas(r=>{const nr={...r};delete nr.setorPer;return nr;});
    }
  },[ticker]);

  // Calcula payout automaticamente quando temos dividendo e EPS
  useEffect(()=>{
    if(divAnual&&eps&&parseFloat(eps)>0){
      const p=(parseFloat(divAnual)/parseFloat(eps)*100).toFixed(0);
      setPayoutCalc(p);
      setRespostas(r=>({...r,payoutOk:parseFloat(p)<=80}));
    }else{
      setPayoutCalc("");
    }
  },[divAnual,eps]);

  const carregarAtivo=useCallback((tick)=>{
    const saved=ativosDB[tick];
    setRoe(saved?.roe||"");
    setDividaEbitda(saved?.dividaEbitda||"");
    // Preserva payoutOk/setorPer já recalculados para o novo ticker (não
    // sobrescrever com dados salvos de outro ativo nem apagar o auto-cálculo).
    setRespostas(r=>{
      const merged={...(saved?.respostas||{})};
      if(r.payoutOk!==undefined) merged.payoutOk=r.payoutOk;
      if(r.setorPer!==undefined) merged.setorPer=r.setorPer;
      return merged;
    });
    setResult(null);
  },[ativosDB]);

  const buscarTudo=useCallback(async(tick)=>{
    if(!tick||tick.length<4) return;
    setFetchStatus("loading");setFetchDivStatus("loading");
    setCotacao("");setDyAtual("");setPl("");setEps("");setDivAnual("");setDyMedio("");
    setDivHistInfo(null);
    try{
      const r=await fetch(`/api/brapi/${tick}?dividends=1`);
      const d=await r.json();
      if(d.price){
        setCotacao(String(d.price));
        if(typeof d.dividendYield==="number") setDyAtual(d.dividendYield.toFixed(2));
        if(typeof d.pl==="number") setPl(d.pl.toFixed(1));
        if(typeof d.eps==="number") setEps(d.eps.toFixed(2));
        setFetchStatus("ok");
      }else{
        setFetchStatus("error");
      }

      const dividends=d.dividends||[];
      if(dividends.length){
        const porAno={};
        dividends.forEach(div=>{
          const ano=new Date(div.date).getFullYear();
          porAno[ano]=(porAno[ano]||0)+(div.value||0);
        });
        const anos=Object.keys(porAno).sort().reverse().slice(0,3);
        if(anos.length){
          const divMediaAnual=anos.reduce((acc,a)=>acc+porAno[a],0)/anos.length;
          const dyMedioCalc=d.price?(divMediaAnual/d.price*100).toFixed(2):null;
          const divAnualCalc=porAno[anos[0]]?.toFixed(2);
          const hist={dyMedio:dyMedioCalc,divAnual:divAnualCalc,anos,porAno,suficiente:anos.length>=3};
          setDivHistInfo(hist);
          setDivAnual(prev=>prev||hist.divAnual||"");
          setDyMedio(hist.dyMedio||"");
          setFetchDivStatus(hist.suficiente?"ok":"parcial");
        }else{
          setFetchDivStatus("error");
        }
      }else{
        setFetchDivStatus("error");
      }
    }catch{
      setFetchStatus("error");
      setFetchDivStatus("error");
    }
  },[]);

  useEffect(()=>{
    if(!ticker||ticker.length<4) return;
    const t=setTimeout(()=>{buscarTudo(ticker);carregarAtivo(ticker);},900);
    return()=>clearTimeout(t);
  },[ticker,dbLoaded]);

  const salvarAtivo=()=>{
    setAtivosDB(db=>({...db,[ticker]:{roe,dividaEbitda,respostas}}));
  };

  const setResposta=(id,val)=>{setRespostas(r=>({...r,[id]:val}));setResult(null);};

  const calcular=()=>{
    const preco=parseFloat(cotacao),div=parseFloat(divAnual),ym=parseFloat(yieldMin)/100;
    if(!preco||!div||!ym){alert("Preencha cotação, dividendo anual e yield mínimo.");return;}
    const precoTeto=div/ym;
    const margemSeguranca=((precoTeto-preco)/precoTeto)*100;
    const dyReal=(div/preco)*100;

    const itensChecklist=CHECKLIST.map(item=>({...item,resposta:respostas[item.id]}));
    const pesoTotal=CHECKLIST.reduce((a,b)=>a+b.peso,0);
    const pesoObtido=itensChecklist.reduce((acc,item)=>item.resposta===true?acc+item.peso:acc,0);
    const respondidos=itensChecklist.filter(i=>i.resposta!==undefined).length;
    const nota=respondidos>0?(pesoObtido/pesoTotal*100):null;

    const veredito=margemSeguranca>=20?"COMPRAR":margemSeguranca>=0?"MONITORAR":"CARO";
    const vereditoColor=margemSeguranca>=20?C.green:margemSeguranca>=0?C.yellow:C.red;
    const notaLabel=nota===null?"INCOMPLETO":nota>=80?"APROVADO":nota>=60?"ATENÇÃO":"REPROVADO";
    const notaColor=nota===null?C.muted:nota>=80?C.green:nota>=60?C.yellow:C.red;

    let vereditoFinal,vereditoFinalColor,vereditoIcon;
    if(veredito==="COMPRAR"&&nota!==null&&nota>=80){vereditoFinal="APTO PARA POSIÇÃO E LANÇAMENTO";vereditoFinalColor=C.green;vereditoIcon="check";}
    else if(veredito==="CARO"){vereditoFinal="PREÇO ACIMA DO TETO — AGUARDAR";vereditoFinalColor=C.red;vereditoIcon="x";}
    else if(nota!==null&&nota<60){vereditoFinal="FUNDAMENTOS FRACOS — EVITAR";vereditoFinalColor=C.red;vereditoIcon="x";}
    else{vereditoFinal="MONITORAR — CONDIÇÕES PARCIAIS";vereditoFinalColor=C.yellow;vereditoIcon="alert";}

    const ressalvas=gerarRessalvas({dyAtual,dyMedio,payoutCalc,setor:setorAuto,precoAtual:preco,precoTeto,checklist:itensChecklist});
    setResult({precoTeto,margemSeguranca,dyReal,preco,div,ym,veredito,vereditoColor,nota,notaLabel,notaColor,vereditoFinal,vereditoFinalColor,vereditoIcon,itensChecklist,pesoObtido,pesoTotal,ressalvas,respondidos});
  };

  const precoTetoEstimado=divAnual&&yieldMin?(parseFloat(divAnual)/parseFloat(yieldMin)*100).toFixed(2):null;

  return(
    <div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text}}>Preço Teto</div>
        <div style={{fontSize:12,color:C.muted}}>
          Metodologia Barsi · <span style={{color:C.green,fontWeight:600}}>● automático</span> · <span style={{color:C.accent2,fontWeight:600}}>● calculado</span> · <span style={{color:C.muted,fontWeight:600}}>● 2 campos manuais</span>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:20,alignItems:"start"}}>
        {/* Coluna esquerda */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card>
            <SectionTitle>Ativo</SectionTitle>
            <Fld label="Ticker">
              <input className="op-input" value={ticker} onChange={e=>{setTicker(e.target.value.toUpperCase());setResult(null);}}
                placeholder="PETR4" style={iS()}/>
            </Fld>

            <div style={{background:C.input,borderRadius:10,padding:12,border:`1px solid ${C.borderSoft}`}}>
              <div style={{fontSize:9.5,color:C.green,fontWeight:700,marginBottom:9,textTransform:"uppercase",letterSpacing:"0.5px"}}>
                ● Dados automáticos
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                {[{l:"Cotação",v:cotacao?`R$ ${cotacao}`:"—"},{l:"DY atual",v:dyAtual?`${dyAtual}%`:"—"},{l:"EPS (LPA)",v:eps?`R$ ${eps}`:"—"},{l:"Setor",v:setorAuto||"—"}].map(({l,v})=>(
                  <div key={l}>
                    <div style={{fontSize:9,color:C.muted}}>{l}</div>
                    <div style={{fontSize:12,fontWeight:600,color:C.text,lineHeight:1.3,fontFamily:"var(--font-mono)"}}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{borderTop:`1px solid ${C.borderSoft}`,paddingTop:8}}>
                {fetchDivStatus==="loading"&&<div style={{fontSize:11,color:C.muted}}>Calculando histórico de dividendos...</div>}
                {fetchDivStatus==="ok"&&divHistInfo&&(
                  <div>
                    <div style={{fontSize:10,color:C.green,fontWeight:700}}>● Dividendos históricos</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:4}}>
                      <div><div style={{fontSize:9,color:C.muted}}>Div. anual (último ano)</div><div style={{fontSize:12,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {divHistInfo.divAnual}</div></div>
                      <div><div style={{fontSize:9,color:C.muted}}>DY médio 3 anos</div><div style={{fontSize:12,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>{divHistInfo.dyMedio}%</div></div>
                    </div>
                  </div>
                )}
                {fetchDivStatus==="parcial"&&divHistInfo&&(
                  <div style={{fontSize:11,color:C.yellow}}>● Histórico parcial ({divHistInfo.anos.length} ano(s)) — verifique no Status Invest</div>
                )}
                {fetchDivStatus==="error"&&(
                  <div style={{fontSize:11,color:C.muted}}>
                    ● Histórico não disponível — informe o dividendo anual abaixo
                    <div style={{marginTop:4}}><ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Status Invest — Proventos</ExtLink></div>
                  </div>
                )}
              </div>

              {payoutCalc&&(
                <div style={{borderTop:`1px solid ${C.borderSoft}`,paddingTop:8,marginTop:8}}>
                  <div style={{fontSize:10,color:C.accent2,fontWeight:700}}>● Payout calculado automaticamente</div>
                  <div style={{fontSize:14,fontWeight:700,color:parseFloat(payoutCalc)<=80?C.green:parseFloat(payoutCalc)<=100?C.yellow:C.red,marginTop:2,fontFamily:"var(--font-mono)"}}>
                    {payoutCalc}%
                    <span style={{fontSize:10,fontWeight:400,color:C.muted,marginLeft:6,fontFamily:"var(--font-sans)"}}>
                      {parseFloat(payoutCalc)<=80?"sustentável":parseFloat(payoutCalc)<=100?"no limite":"insustentável"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <Btn onClick={()=>buscarTudo(ticker)} variant="secondary" style={{width:"100%",marginTop:10,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <Icon name="refresh" size={13}/> Atualizar
            </Btn>
          </Card>

          <Card>
            <SectionTitle>Ajustes <span style={{fontWeight:400,fontSize:10,textTransform:"none"}}>(edite se necessário)</span></SectionTitle>

            <Fld label={<>Dividendo anual / ação (R$) <AutoTag tipo={divHistInfo?"auto":"manual"}/></>}>
              <div style={{position:"relative"}}>
                <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>R$</span>
                <input className="op-input" type="number" value={divAnual}
                  onChange={e=>{setDivAnual(e.target.value);setResult(null);}}
                  placeholder="3.50"
                  style={iS({paddingLeft:26,border:`1px solid ${divHistInfo?C.green+"44":C.border}`,background:divHistInfo?C.green+"0A":C.input})}/>
              </div>
            </Fld>

            <Fld label="Yield mínimo desejado (%)" hint="Barsi usa 6% — mais conservador = teto menor">
              <div style={{position:"relative"}}>
                <input className="op-input" type="number" value={yieldMin} onChange={e=>{setYieldMin(e.target.value);setResult(null);}}
                  placeholder="6" style={iS({paddingRight:22,border:`1px solid ${C.accent}44`,background:C.accent+"0D"})}/>
                <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",color:C.accent,fontSize:12}}>%</span>
              </div>
            </Fld>

            {precoTetoEstimado&&(
              <div style={{background:C.accent+"0D",borderRadius:10,padding:11,border:`1px solid ${C.borderSoft}`}}>
                <div style={{fontSize:10,color:C.muted}}>Preço teto calculado</div>
                <div style={{fontSize:20,fontWeight:800,color:C.accent,fontFamily:"var(--font-mono)"}}>R$ {precoTetoEstimado}</div>
                {cotacao&&(
                  <div style={{fontSize:11,marginTop:2,color:parseFloat(cotacao)<parseFloat(precoTetoEstimado)?C.green:C.red,fontWeight:600}}>
                    {parseFloat(cotacao)<parseFloat(precoTetoEstimado)
                      ?`${(((parseFloat(precoTetoEstimado)-parseFloat(cotacao))/parseFloat(precoTetoEstimado))*100).toFixed(0)}% abaixo do teto`
                      :`${(((parseFloat(cotacao)-parseFloat(precoTetoEstimado))/parseFloat(precoTetoEstimado))*100).toFixed(0)}% acima do teto`}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card style={{border:`1px solid ${C.borderSoft}`}}>
            <SectionTitle>2 campos manuais</SectionTitle>
            <div style={{fontSize:11,color:C.muted,marginBottom:10,lineHeight:1.5}}>
              Apenas esses dois precisam ser consultados manualmente. Salve uma vez por ativo.
            </div>

            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>ROE (%)</div>
                <ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Status Invest</ExtLink>
              </div>
              <div style={{position:"relative"}}>
                <input className="op-input" type="number" value={roe} onChange={e=>{setRoe(e.target.value);setResult(null);}}
                  placeholder="Acima de 10% é bom" style={iS({paddingRight:22})}/>
                <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>%</span>
              </div>
              {roe&&(
                <div style={{fontSize:10,marginTop:4,color:parseFloat(roe)>=10?C.green:C.red,display:"flex",alignItems:"center",gap:4}}>
                  <Icon name={parseFloat(roe)>=10?"check":"x"} size={11}/> {parseFloat(roe)>=15?"Excelente":parseFloat(roe)>=10?"Bom":"Abaixo do esperado"}
                </div>
              )}
            </div>

            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>Dívida líq./EBITDA</div>
                <ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Status Invest</ExtLink>
              </div>
              <input className="op-input" type="number" value={dividaEbitda} onChange={e=>{setDividaEbitda(e.target.value);setResult(null);}}
                placeholder="Abaixo de 2,5 é saudável" style={iS()}/>
              {dividaEbitda&&(
                <div style={{fontSize:10,marginTop:4,color:parseFloat(dividaEbitda)<=2?C.green:parseFloat(dividaEbitda)<=2.5?C.yellow:C.red,display:"flex",alignItems:"center",gap:4}}>
                  <Icon name={parseFloat(dividaEbitda)<=2.5?"check":"x"} size={11}/> {parseFloat(dividaEbitda)<=2?"Confortável":parseFloat(dividaEbitda)<=2.5?"Aceitável":"Elevado"}
                </div>
              )}
            </div>

            <Btn onClick={salvarAtivo} variant="secondary" style={{width:"100%",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <Icon name="save" size={13}/> Salvar dados de {ticker}
            </Btn>
          </Card>

          <Btn onClick={calcular} style={{width:"100%"}} variant="primary">Analisar →</Btn>
        </div>

        {/* Coluna direita */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Checklist */}
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <SectionTitle>Checklist de Qualidade — 6 critérios</SectionTitle>
              <ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Status Invest</ExtLink>
            </div>

            {CHECKLIST.map(item=>{
              const resp=respostas[item.id];
              const isExp=expandedDica===item.id;
              const fonte=item.fonte?item.fonte(ticker):null;
              return(
                <div key={item.id} style={{
                  borderRadius:10,marginBottom:8,
                  background:resp===true?C.green+"0A":resp===false?C.red+"0A":C.input,
                  border:`1px solid ${resp===true?C.green+"44":resp===false?C.red+"44":C.borderSoft}`
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px"}}>
                    <div style={{flexShrink:0,color:resp===true?C.green:resp===false?C.red:C.muted}}>
                      <Icon name={resp===true?"check":resp===false?"x":"circle"} size={16}/>
                    </div>

                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,color:C.text,lineHeight:1.4,fontWeight:500}}>{item.label}</span>
                        <span style={{fontSize:9,background:C.card,borderRadius:10,padding:"1px 6px",color:C.muted}}>peso {item.peso}</span>
                        {item.auto&&<AutoTag tipo={item.id==="payoutOk"?"calc":"auto"}/>}
                      </div>
                      {item.id==="payoutOk"&&payoutCalc&&(
                        <div style={{fontSize:10,color:parseFloat(payoutCalc)<=80?C.green:C.red,marginTop:2}}>
                          Payout calculado: {payoutCalc}% → resposta automática: {parseFloat(payoutCalc)<=80?"SIM":"NÃO"}
                        </div>
                      )}
                      {item.id==="setorPer"&&setorAuto&&(
                        <div style={{fontSize:10,color:isCiclico(setorAuto)?C.yellow:C.green,marginTop:2}}>
                          Setor detectado: {setorAuto} → {isCiclico(setorAuto)?"cíclico — resposta automática: NÃO":"perene — resposta automática: SIM"}
                        </div>
                      )}
                    </div>

                    <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
                      <button className="op-btn" onClick={()=>setExpandedDica(isExp?null:item.id)} style={{
                        padding:"4px 9px",borderRadius:7,border:`1px solid ${isExp?C.accent:C.border}`,
                        background:isExp?C.accent+"14":"transparent",color:isExp?C.accent:C.muted,
                        cursor:"pointer",fontSize:11
                      }}>{isExp?"▲":"▼"}</button>
                      {[{l:"SIM",v:true,ac:C.green},{l:"NÃO",v:false,ac:C.red}].map(({l,v,ac})=>(
                        <button key={l} className="op-btn" onClick={()=>setResposta(item.id,v)} style={{
                          padding:"4px 12px",borderRadius:7,
                          border:`1px solid ${resp===v?ac:C.border}`,
                          background:resp===v?ac+"22":"transparent",
                          color:resp===v?ac:C.muted,
                          cursor:"pointer",fontSize:12,fontWeight:600
                        }}>{l}</button>
                      ))}
                    </div>
                  </div>

                  {isExp&&(
                    <div style={{padding:"9px 12px 11px",borderTop:`1px solid ${C.borderSoft}`,borderRadius:"0 0 10px 10px"}}>
                      <div style={{display:"flex",gap:6,fontSize:11,color:C.muted,marginBottom:6,lineHeight:1.5}}>
                        <Icon name="info" size={13} style={{flexShrink:0,marginTop:1}}/> {item.dica}
                      </div>
                      {fonte
                        ?<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:10,color:C.muted}}>Onde ver:</span><ExtLink href={fonte.url}>{fonte.label}</ExtLink></div>
                        :<div style={{fontSize:10,color:C.muted}}>Avaliação subjetiva</div>
                      }
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{marginTop:8,padding:"9px 11px",background:C.input,borderRadius:9,border:`1px solid ${C.borderSoft}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:11,color:C.muted}}>Progresso</span>
                <span style={{fontSize:11,color:C.muted}}>{Object.keys(respostas).length}/{CHECKLIST.length} respondidos</span>
              </div>
              <div style={{background:C.border,borderRadius:20,height:5,overflow:"hidden"}}>
                <div style={{width:`${Object.keys(respostas).length/CHECKLIST.length*100}%`,height:"100%",background:C.accent,borderRadius:20,transition:"width 0.3s"}}/>
              </div>
            </div>
          </Card>

          {/* Resultado */}
          {result?(
            <>
              <div style={{background:result.vereditoFinalColor+"12",border:`1px solid ${result.vereditoFinalColor}44`,
                borderRadius:14,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,
                boxShadow:`0 8px 24px ${result.vereditoFinalColor}14`}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{color:result.vereditoFinalColor,flexShrink:0}}><Icon name={result.vereditoIcon} size={22}/></div>
                  <div>
                    <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>Conclusão</div>
                    <div style={{fontSize:16,fontWeight:800,color:result.vereditoFinalColor}}>{result.vereditoFinal}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,flexShrink:0}}>
                  <Badge color={result.vereditoColor}>{result.veredito}</Badge>
                  {result.nota!==null&&<Badge color={result.notaColor}>{result.notaLabel} {result.nota.toFixed(0)}%</Badge>}
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                <Metric label="Preço Teto" value={`R$ ${result.precoTeto.toFixed(2)}`} sub={`Div ÷ ${(result.ym*100).toFixed(0)}%`} hi={C.accent}/>
                <Metric label="Cotação Atual" value={`R$ ${result.preco.toFixed(2)}`} hi={result.vereditoColor}/>
                <Metric label="Margem Segurança" value={`${result.margemSeguranca.toFixed(1)}%`}
                  sub={result.margemSeguranca>=20?"Boa":result.margemSeguranca>=0?"Baixa":"Acima do teto"}
                  hi={result.margemSeguranca>=20?C.green:result.margemSeguranca>=0?C.yellow:C.red}/>
                <Metric label="DY Real" value={`${result.dyReal.toFixed(2)}%`} sub="ao preço atual"
                  hi={result.dyReal>=6?C.green:result.dyReal>=4?C.yellow:C.red}/>
              </div>

              {result.nota!==null&&(
                <Card>
                  <SectionTitle>Nota do Checklist</SectionTitle>
                  <div style={{display:"flex",alignItems:"center",gap:16}}>
                    <div style={{fontSize:34,fontWeight:800,color:result.notaColor,fontFamily:"var(--font-mono)"}}>{result.nota.toFixed(0)}%</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:600,color:result.notaColor,marginBottom:4}}>{result.notaLabel}</div>
                      <div style={{fontSize:12,color:C.muted,marginBottom:6}}>{result.pesoObtido}/{result.pesoTotal} pontos · {result.respondidos}/{CHECKLIST.length} respondidos</div>
                      <div style={{background:C.input,borderRadius:20,height:8,overflow:"hidden"}}>
                        <div style={{width:`${result.nota}%`,height:"100%",background:result.nota>=80?C.green:result.nota>=60?C.yellow:C.red,borderRadius:20,transition:"width 0.5s"}}/>
                      </div>
                    </div>
                    {result.respondidos<CHECKLIST.length&&(
                      <div style={{fontSize:11,color:C.yellow,display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                        <Icon name="alert" size={13}/> {CHECKLIST.length-result.respondidos} sem resposta
                      </div>
                    )}
                  </div>
                </Card>
              )}

              <Card style={{border:`1px solid ${C.orange}33`}}>
                <SectionTitle color={C.orange}>Ressalvas e Limitações</SectionTitle>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {result.ressalvas.map((r,i)=>{
                    const col=r.tipo==="bad"?C.red:r.tipo==="warn"?C.yellow:C.accent;
                    const ic=r.tipo==="bad"?"x":r.tipo==="warn"?"alert":"info";
                    return(
                      <div key={i} style={{display:"flex",gap:8,padding:"9px 11px",borderRadius:9,background:col+"0A",border:`1px solid ${col}22`}}>
                        <span style={{color:col,flexShrink:0,marginTop:1}}><Icon name={ic} size={14}/></span>
                        <span style={{fontSize:12,color:C.text,lineHeight:1.5}}>{r.texto}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          ):(
            <EmptyState icon="target" title="Digite o ticker e o sistema preenche automaticamente" desc={
              <span style={{display:"block",lineHeight:1.9,textAlign:"left"}}>
                <span style={{display:"block"}}><span style={{color:C.green}}>●</span> Cotação, DY, EPS, dividendo anual, DY médio 3 anos — automático</span>
                <span style={{display:"block"}}><span style={{color:C.accent2}}>●</span> Payout e setor — calculados automaticamente</span>
                <span style={{display:"block"}}><span style={{color:C.muted}}>●</span> Só ROE e Dívida/EBITDA precisam ser consultados</span>
              </span>
            }/>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// APP ROOT
// ════════════════════════════════════════════════════════════════════
const TABS=[
  {id:"analisar",label:"Analisar",icon:"zap",comp:TabAnalisar},
  {id:"comparar",label:"Comparar Strikes",icon:"bars",comp:TabComparar},
  {id:"posicoes",label:"Posições",icon:"clipboard",comp:TabPosicoes},
  {id:"rolagem",label:"Rolagem",icon:"refresh",comp:TabRolagem},
  {id:"performance",label:"Performance",icon:"trending",comp:TabPerformance},
  {id:"precoteto",label:"Preço Teto",icon:"target",comp:TabPrecoTeto},
];

function LogoutButton(){
  const sair=async()=>{
    await fetch("/api/logout",{method:"POST"});
    window.location.href="/login";
  };
  return (
    <button className="op-btn" onClick={sair} style={{
      marginLeft:"auto",display:"flex",alignItems:"center",gap:6,
      background:"transparent",border:`1px solid ${C.border}`,
      color:C.muted,borderRadius:8,padding:"7px 13px",fontSize:11.5,fontWeight:600,cursor:"pointer"
    }}>
      <Icon name="logout" size={13}/> Sair
    </button>
  );
}

export default function OpcoesApp(){
  const [tab,setTab]=useState("analisar");
  const Comp=TABS.find(t=>t.id===tab)?.comp||TabAnalisar;
  return(
    <div style={{minHeight:"100vh",background:C.bgGradient,color:C.text,fontFamily:"var(--font-sans)"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {/* Header */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.borderSoft}`,padding:"14px 24px",
                   display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:36,height:36,borderRadius:10,
                     background:"linear-gradient(135deg, #5B8DEF 0%, #7C6CF0 100%)",
                     display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",
                     boxShadow:"0 4px 14px rgba(91,141,239,0.35)"}}>
          <Icon name="zap" size={19}/>
        </div>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontWeight:700,fontSize:15,letterSpacing:"-0.2px"}}>Opções B3</div>
            <span style={{fontSize:9,fontWeight:700,color:C.accent,background:C.accent+"1A",
                          border:`1px solid ${C.accent}33`,borderRadius:20,padding:"2px 7px",letterSpacing:"0.4px"}}>BETA</span>
          </div>
          <div style={{fontSize:11.5,color:C.muted,marginTop:1}}>Black-Scholes · Volatilidade automática · Gestão de posições</div>
        </div>
        <LogoutButton/>
      </div>
      {/* Tabs */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.borderSoft}`,padding:"0 20px",
                   display:"flex",gap:2}}>
        {TABS.map(t=>{
          const active=tab===t.id;
          return(
            <button key={t.id} className="op-tab" onClick={()=>setTab(t.id)} style={{
              display:"flex",alignItems:"center",gap:7,padding:"11px 14px",margin:"6px 0",
              background:active?C.accent+"14":"transparent",border:"none",borderRadius:8,cursor:"pointer",
              fontSize:12.5,fontWeight:600,color:active?C.accent:C.muted
            }}>
              <Icon name={t.icon} size={15}/>
              {t.label}
            </button>
          );
        })}
      </div>
      {/* Content */}
      <div style={{maxWidth:1200,margin:"0 auto",padding:20}}>
        <Comp/>
      </div>
    </div>
  );
}
