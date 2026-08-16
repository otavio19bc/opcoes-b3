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
    case"clock":return<svg{...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case"star":return<svg{...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
    case"shield":return<svg{...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case"edit":return<svg{...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case"chevron-left":return<svg{...p}><polyline points="15 18 9 12 15 6"/></svg>;
    case"chevron-right":return<svg{...p}><polyline points="9 18 15 12 9 6"/></svg>;
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
// ABA — POSIÇÕES
// ════════════════════════════════════════════════════════════════════
const STATUS_OPTIONS=["Aberta","Encerrada","Exercida","Rolada"];
const STATUS_COLORS={Aberta:C.accent,Encerrada:C.green,Exercida:C.orange,Rolada:C.accent2};

function hojeISO(){return new Date().toISOString().split("T")[0];}

function blankForm(){
  return{ativo:"",tipo:"call",codigoOpcao:"",strike:"",premio:"",qtd:"100",
    dataVenc:getNextExpiry(),precoEntrada:"",dataLancamento:hojeISO(),
    corretagem:"",observacoes:""};
}

function calcPosicao(p){
  const dias=diasAte(p.dataVenc);
  const alerta=dias<=5&&p.status==="Aberta";
  const noc=p.tipo==="call"?p.precoEntrada*p.qtd:p.strike*p.qtd;
  const recompra=(p.recompra===""||p.recompra==null)?0:parseFloat(p.recompra);
  const corretagem=parseFloat(p.corretagem)||0;
  const precoSaida=(p.precoSaida===""||p.precoSaida==null)?null:parseFloat(p.precoSaida);
  // Lucro/prejuízo na venda antecipada do ativo (call: base = preço de entrada; put: base = strike, preço de exercício)
  const lucroAtivo=precoSaida!=null?(p.tipo==="call"?(precoSaida-p.precoEntrada):(precoSaida-p.strike))*p.qtd:0;
  const resultadoOpcao=(p.premio-recompra)*p.qtd-corretagem;
  const resultado=resultadoOpcao+lucroAtivo;
  const retorno=noc?(resultado/noc)*100:0;
  return{dias,alerta,noc,resultado,resultadoOpcao,lucroAtivo,retorno};
}

function StatusSelect({value,onChange}){
  const color=STATUS_COLORS[value]||C.muted;
  const arrow=encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>`);
  return(
    <select value={value} onChange={e=>onChange(e.target.value)} style={{
      backgroundColor:color+"1F",backgroundImage:`url("data:image/svg+xml,${arrow}")`,
      backgroundRepeat:"no-repeat",backgroundPosition:"right 7px center",backgroundSize:"12px",
      color,border:`1px solid ${color}55`,borderRadius:20,
      fontSize:10,fontWeight:700,padding:"4px 24px 4px 10px",cursor:"pointer",
      outline:"none",appearance:"none",WebkitAppearance:"none",fontFamily:"var(--font-sans)"
    }}>
      {STATUS_OPTIONS.map(s=><option key={s} value={s} style={{background:C.card,color:C.text}}>{s}</option>)}
    </select>
  );
}

function TabPosicoes(){
  const [posicoes,setPosicoes]=useState([]);
  const [form,setForm]=useState(blankForm());
  const [showForm,setShowForm]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [editandoId,setEditandoId]=useState(null);
  const [editForm,setEditForm]=useState(null);

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
    if(!form.ativo||!form.strike||!form.premio||!form.precoEntrada){alert("Preencha ativo, strike, prêmio e preço de entrada.");return;}
    const nova={
      id:Date.now(),ativo:form.ativo.toUpperCase(),tipo:form.tipo,
      codigoOpcao:form.codigoOpcao.toUpperCase(),
      strike:parseFloat(form.strike),premio:parseFloat(form.premio),
      qtd:parseInt(form.qtd)||0,dataVenc:form.dataVenc,
      precoEntrada:parseFloat(form.precoEntrada),
      dataLancamento:form.dataLancamento||hojeISO(),
      dataEncerramento:"",recompra:"",precoSaida:"",
      corretagem:parseFloat(form.corretagem)||0,
      status:"Aberta",observacoes:form.observacoes
    };
    setPosicoes(p=>[...p,nova]);
    setForm(blankForm());
    setShowForm(false);
  };

  const remover=(id)=>{
    if(editandoId===id){setEditandoId(null);setEditForm(null);}
    setPosicoes(p=>p.filter(x=>x.id!==id));
  };

  const atualizarStatus=(id,status)=>{
    setPosicoes(list=>list.map(p=>{
      if(p.id!==id) return p;
      const dataEncerramento=(status!=="Aberta"&&!p.dataEncerramento)?hojeISO():(status==="Aberta"?"":p.dataEncerramento);
      return{...p,status,dataEncerramento};
    }));
  };

  const iniciarEdicao=(p)=>{
    setEditandoId(p.id);
    setEditForm({
      codigoOpcao:p.codigoOpcao||"",strike:String(p.strike),premio:String(p.premio),
      qtd:String(p.qtd),dataVenc:p.dataVenc,precoEntrada:String(p.precoEntrada),
      dataLancamento:p.dataLancamento||"",dataEncerramento:p.dataEncerramento||"",
      recompra:p.recompra!==""&&p.recompra!=null?String(p.recompra):"",
      precoSaida:p.precoSaida!==""&&p.precoSaida!=null?String(p.precoSaida):"",
      corretagem:p.corretagem!=null?String(p.corretagem):"0",
      status:p.status||"Aberta",
      observacoes:p.observacoes||""
    });
  };
  const cancelarEdicao=()=>{setEditandoId(null);setEditForm(null);};
  const setEF=(k,v)=>setEditForm(f=>({...f,[k]:v}));

  const salvarEdicao=(id)=>{
    setPosicoes(list=>list.map(p=>{
      if(p.id!==id) return p;
      const status=editForm.status;
      const dataEncerramento=status==="Aberta"?"":(editForm.dataEncerramento||hojeISO());
      return{
        ...p,
        codigoOpcao:editForm.codigoOpcao.toUpperCase(),
        strike:parseFloat(editForm.strike)||p.strike,
        premio:parseFloat(editForm.premio)||p.premio,
        qtd:parseInt(editForm.qtd)||p.qtd,
        dataVenc:editForm.dataVenc,
        precoEntrada:parseFloat(editForm.precoEntrada)||p.precoEntrada,
        dataLancamento:editForm.dataLancamento,
        dataEncerramento,
        recompra:editForm.recompra===""?"":parseFloat(editForm.recompra),
        precoSaida:editForm.precoSaida===""?"":parseFloat(editForm.precoSaida),
        corretagem:parseFloat(editForm.corretagem)||0,
        status,
        observacoes:editForm.observacoes
      };
    }));
    setEditandoId(null);setEditForm(null);
  };

  const totalNocional=posicoes.reduce((acc,p)=>acc+calcPosicao(p).noc,0);
  const totalPremio=posicoes.reduce((acc,p)=>acc+p.premio*p.qtd,0);

  const exposicao=(tipo)=>{
    const list=posicoes.filter(p=>p.tipo===tipo);
    const abertas=list.filter(p=>p.status==="Aberta");
    const encerradas=list.filter(p=>p.status!=="Aberta");
    return{
      abertas:abertas.length,
      nocionalAberto:abertas.reduce((a,p)=>a+calcPosicao(p).noc,0),
      encerradas:encerradas.length,
      resultadoEncerradas:encerradas.reduce((a,p)=>a+calcPosicao(p).resultado,0)
    };
  };
  const expCall=exposicao("call");
  const expPut=exposicao("put");
  const expTotal={
    abertas:expCall.abertas+expPut.abertas,
    nocionalAberto:expCall.nocionalAberto+expPut.nocionalAberto,
    encerradas:expCall.encerradas+expPut.encerradas,
    resultadoEncerradas:expCall.resultadoEncerradas+expPut.resultadoEncerradas
  };

  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>Posições</div>
          <div style={{fontSize:12,color:C.muted}}>
            {posicoes.length} posição(ões) · Nocional total: <span style={{color:C.accent,fontFamily:"var(--font-mono)"}}>R$ {totalNocional.toFixed(0)}</span> · Prêmio recebido: <span style={{color:C.green,fontFamily:"var(--font-mono)"}}>R$ {totalPremio.toFixed(2)}</span>
          </div>
        </div>
        <Btn onClick={()=>setShowForm(!showForm)} variant={showForm?"secondary":"primary"}>
          {showForm?"Cancelar":"+ Adicionar Posição"}
        </Btn>
      </div>

      {/* Form de nova posição */}
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
            <Fld label="Código da opção"><input className="op-input" value={form.codigoOpcao} onChange={e=>setF("codigoOpcao",e.target.value.toUpperCase())} placeholder="PETRH452" style={iS()}/></Fld>
            <Fld label="Strike"><input className="op-input" type="number" value={form.strike} onChange={e=>setF("strike",e.target.value)} placeholder="45.05" style={iS()}/></Fld>
            <Fld label="Prêmio recebido/ação"><input className="op-input" type="number" value={form.premio} onChange={e=>setF("premio",e.target.value)} placeholder="1.44" style={iS()}/></Fld>
            <Fld label="Quantidade"><input className="op-input" type="number" value={form.qtd} onChange={e=>setF("qtd",e.target.value)} placeholder="100" style={iS()}/></Fld>
            <Fld label="Vencimento"><input className="op-input" type="date" value={form.dataVenc} onChange={e=>setF("dataVenc",e.target.value)} style={iS()}/></Fld>
            <Fld label="Preço de entrada do ativo"><input className="op-input" type="number" value={form.precoEntrada} onChange={e=>setF("precoEntrada",e.target.value)} placeholder="41.81" style={iS()}/></Fld>
            <Fld label="Data de lançamento"><input className="op-input" type="date" value={form.dataLancamento} onChange={e=>setF("dataLancamento",e.target.value)} style={iS()}/></Fld>
            <Fld label="Corretagem (R$)"><input className="op-input" type="number" value={form.corretagem} onChange={e=>setF("corretagem",e.target.value)} placeholder="0.00" style={iS()}/></Fld>
            <div style={{gridColumn:"span 2"}}>
              <Fld label="Observações"><input className="op-input" value={form.observacoes} onChange={e=>setF("observacoes",e.target.value)} placeholder="opcional" style={iS()}/></Fld>
            </div>
            <Fld label=""><div style={{paddingTop:18}}><Btn onClick={adicionar} style={{width:"100%"}}>Adicionar</Btn></div></Fld>
          </div>
        </Card>
      )}

      {/* Lista */}
      {posicoes.length===0?(
        <EmptyState icon="clipboard" title="Nenhuma posição registrada"
          desc='Clique em "+ Adicionar Posição" para registrar seus lançamentos'/>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
          {posicoes.map(p=>{
            const{dias,alerta,noc,resultado,lucroAtivo,retorno}=calcPosicao(p);
            const editando=editandoId===p.id;
            return(
              <Card key={p.id} style={{border:`1px solid ${alerta?C.red+"44":C.borderSoft}`}}>
                <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div style={{minWidth:90}}>
                    <div style={{fontSize:16,fontWeight:700,color:C.text}}>{p.ativo}</div>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginTop:3,flexWrap:"wrap"}}>
                      <Badge color={p.tipo==="call"?C.accent:"#A78BFA"}>{p.tipo==="call"?"Call":"Put"}</Badge>
                      {editando?(
                        <Badge color={STATUS_COLORS[p.status]||C.muted}>{p.status||"Aberta"}</Badge>
                      ):(
                        <StatusSelect value={p.status||"Aberta"} onChange={s=>atualizarStatus(p.id,s)}/>
                      )}
                    </div>
                    {p.codigoOpcao&&<div style={{fontSize:10,color:C.muted,marginTop:3,fontFamily:"var(--font-mono)"}}>{p.codigoOpcao}</div>}
                  </div>
                  <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,minWidth:420}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>STRIKE</div>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {p.strike.toFixed(2)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>QTD.</div>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>{p.qtd}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>PRÊMIO/AÇÃO</div>
                      <div style={{fontSize:13,fontWeight:600,color:C.green,fontFamily:"var(--font-mono)"}}>R$ {p.premio.toFixed(2)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>NOCIONAL</div>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {noc.toFixed(0)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>RESULTADO LÍQ.</div>
                      <div style={{fontSize:13,fontWeight:600,color:resultado>=0?C.green:C.red,fontFamily:"var(--font-mono)"}}>R$ {resultado.toFixed(2)}</div>
                      {lucroAtivo!==0&&<div style={{fontSize:8.5,color:C.muted,fontFamily:"var(--font-mono)"}}>ativo: {lucroAtivo>=0?"+":""}{lucroAtivo.toFixed(2)}</div>}
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>RETORNO</div>
                      <div style={{fontSize:13,fontWeight:600,color:retorno>=0?C.yellow:C.red,fontFamily:"var(--font-mono)"}}>{retorno.toFixed(2)}%</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:600}}>VENCIMENTO</div>
                      <div style={{fontSize:13,fontWeight:600,color:alerta?C.red:dias<=10&&p.status==="Aberta"?C.yellow:C.text,fontFamily:"var(--font-mono)",
                        display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                        {dias}d {alerta&&<Icon name="alert" size={12}/>}
                      </div>
                      <div style={{fontSize:9,color:C.muted}}>{p.dataVenc}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <Btn onClick={()=>editando?cancelarEdicao():iniciarEdicao(p)} variant="secondary" style={{padding:"6px 10px",fontSize:11,display:"flex",alignItems:"center",gap:5}}>
                      <Icon name={editando?"x":"edit"} size={12}/> {editando?"Fechar":"Editar"}
                    </Btn>
                    <Btn onClick={()=>remover(p.id)} variant="danger" style={{padding:"6px 10px",fontSize:11}}>Remover</Btn>
                  </div>
                </div>

                {p.observacoes&&!editando&&(
                  <div style={{marginTop:10,fontSize:11,color:C.muted,fontStyle:"italic"}}>{p.observacoes}</div>
                )}

                {alerta&&(
                  <div style={{marginTop:10,padding:"8px 10px",background:C.red+"0F",borderRadius:8,fontSize:11,color:C.red,
                    display:"flex",alignItems:"center",gap:6}}>
                    <Icon name="alert" size={13}/> Vence em {dias} dia(s) — decida: fechar, rolar ou deixar expirar
                  </div>
                )}

                {editando&&editForm&&(
                  <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.borderSoft}`}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                      <Fld label="Status">
                        <select className="op-select" value={editForm.status} onChange={e=>setEF("status",e.target.value)} style={iS()}>
                          {STATUS_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                      </Fld>
                      <Fld label="Código da opção"><input className="op-input" value={editForm.codigoOpcao} onChange={e=>setEF("codigoOpcao",e.target.value.toUpperCase())} style={iS()}/></Fld>
                      <Fld label="Strike"><input className="op-input" type="number" value={editForm.strike} onChange={e=>setEF("strike",e.target.value)} style={iS()}/></Fld>
                      <Fld label="Prêmio/ação"><input className="op-input" type="number" value={editForm.premio} onChange={e=>setEF("premio",e.target.value)} style={iS()}/></Fld>
                      <Fld label="Quantidade"><input className="op-input" type="number" value={editForm.qtd} onChange={e=>setEF("qtd",e.target.value)} style={iS()}/></Fld>
                      <Fld label="Preço do ativo na entrada"><input className="op-input" type="number" value={editForm.precoEntrada} onChange={e=>setEF("precoEntrada",e.target.value)} style={iS()}/></Fld>
                      <Fld label="Vencimento"><input className="op-input" type="date" value={editForm.dataVenc} onChange={e=>setEF("dataVenc",e.target.value)} style={iS()}/></Fld>
                      <Fld label="Data de lançamento"><input className="op-input" type="date" value={editForm.dataLancamento} onChange={e=>setEF("dataLancamento",e.target.value)} style={iS()}/></Fld>
                      <Fld label="Data de encerramento"><input className="op-input" type="date" value={editForm.dataEncerramento} onChange={e=>setEF("dataEncerramento",e.target.value)} style={iS()}/></Fld>
                      <Fld label="Recompra da opção (R$)" hint="Vazio = expirou pó">
                        <input className="op-input" type="number" value={editForm.recompra} onChange={e=>setEF("recompra",e.target.value)} placeholder="vazio = pó" style={iS()}/>
                      </Fld>
                      <Fld label="Preço de saída do ativo (R$)" hint="Só se vendeu a ação antes do vencimento">
                        <input className="op-input" type="number" value={editForm.precoSaida} onChange={e=>setEF("precoSaida",e.target.value)} placeholder="saída antecipada" style={iS()}/>
                      </Fld>
                      <Fld label="Corretagem (R$)"><input className="op-input" type="number" value={editForm.corretagem} onChange={e=>setEF("corretagem",e.target.value)} style={iS()}/></Fld>
                      <div style={{gridColumn:"span 2"}}>
                        <Fld label="Observações"><input className="op-input" value={editForm.observacoes} onChange={e=>setEF("observacoes",e.target.value)} style={iS()}/></Fld>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <Btn onClick={()=>salvarEdicao(p.id)} style={{flex:1}}>Salvar alterações</Btn>
                      <Btn onClick={cancelarEdicao} variant="secondary" style={{flex:1}}>Cancelar</Btn>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Exposição consolidada */}
      {posicoes.length>0&&(
        <Card>
          <SectionTitle>Exposição Consolidada</SectionTitle>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            {[{titulo:"Call Coberta",cor:C.accent,d:expCall},
              {titulo:"Put Vendida",cor:"#A78BFA",d:expPut},
              {titulo:"Consolidado",cor:C.text,d:expTotal}].map(({titulo,cor,d})=>(
              <div key={titulo} style={{background:C.input,borderRadius:10,padding:14,border:`1px solid ${C.borderSoft}`}}>
                <div style={{fontSize:12,fontWeight:700,color:cor,marginBottom:10}}>{titulo}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div>
                    <div style={{fontSize:9,color:C.muted,fontWeight:600}}>OPERAÇÕES ABERTAS</div>
                    <div style={{fontSize:16,fontWeight:700,color:C.text,fontFamily:"var(--font-mono)"}}>{d.abertas}</div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.muted,fontWeight:600}}>NOCIONAL ABERTO</div>
                    <div style={{fontSize:16,fontWeight:700,color:C.text,fontFamily:"var(--font-mono)"}}>R$ {d.nocionalAberto.toFixed(0)}</div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.muted,fontWeight:600}}>ENCERRADAS</div>
                    <div style={{fontSize:16,fontWeight:700,color:C.text,fontFamily:"var(--font-mono)"}}>{d.encerradas}</div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.muted,fontWeight:600}}>RESULTADO ENCERRADAS</div>
                    <div style={{fontSize:16,fontWeight:700,color:d.resultadoEncerradas>=0?C.green:C.red,fontFamily:"var(--font-mono)"}}>R$ {d.resultadoEncerradas.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
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
// ABA — PERFORMANCE
// ════════════════════════════════════════════════════════════════════
const MESES=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function TabPerformance(){
  const [posicoes,setPosicoes]=useState([]);
  const [ano,setAno]=useState(new Date().getFullYear());
  const [meta,setMeta]=useState("2000");
  const [capital,setCapital]=useState("50000");
  const [selic,setSelic]=useState("14");
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem("op_posicoes")||"[]");
      setPosicoes(saved);
    }catch{}
    try{
      const cfg=JSON.parse(localStorage.getItem("op_performance_cfg")||"{}");
      if(cfg.meta!=null) setMeta(cfg.meta);
      if(cfg.capital!=null) setCapital(cfg.capital);
      if(cfg.selic!=null) setSelic(cfg.selic);
    }catch{}
    setLoaded(true);
  },[]);

  useEffect(()=>{
    if(!loaded) return;
    localStorage.setItem("op_performance_cfg",JSON.stringify({meta,capital,selic}));
  },[meta,capital,selic,loaded]);

  const fechadas=posicoes.filter(p=>(p.status==="Encerrada"||p.status==="Exercida")&&p.dataEncerramento);
  const fechadasAno=fechadas.filter(p=>new Date(p.dataEncerramento).getFullYear()===ano);

  const metaV=parseFloat(meta)||0;
  const capitalV=parseFloat(capital)||0;
  const selicAnualV=parseFloat(selic)||0;
  const selicMesPct=(Math.pow(1+selicAnualV/100,1/12)-1)*100;

  const data=MESES.map((m,i)=>{
    const doMes=fechadasAno.filter(p=>new Date(p.dataEncerramento).getMonth()===i);
    const resultado=doMes.reduce((a,p)=>a+calcPosicao(p).resultado,0);
    return{mes:m,resultado,selicMes:selicMesPct,hasData:doMes.length>0,qtd:doMes.length};
  });

  const totalRes=data.reduce((a,d)=>a+d.resultado,0);
  const mesesComDados=data.filter(d=>d.hasData);
  const acertos=mesesComDados.filter(d=>d.resultado>=metaV).length;
  const retornoCapital=capitalV?(totalRes/capitalV)*100:0;
  const mediaMensal=mesesComDados.length>0?totalRes/mesesComDados.length:0;

  let acc=0;
  const acumulado=data.map(d=>{acc+=d.resultado;return{mes:d.mes,valor:acc,hasData:d.hasData};});

  const porAtivoMap={};
  fechadasAno.forEach(p=>{
    const r=calcPosicao(p).resultado;
    porAtivoMap[p.ativo]=(porAtivoMap[p.ativo]||0)+r;
  });
  const porAtivo=Object.entries(porAtivoMap).map(([ativo,resultado])=>({ativo,resultado})).sort((a,b)=>b.resultado-a.resultado);
  const maxAtivoAbs=Math.max(...porAtivo.map(a=>Math.abs(a.resultado)),1);

  const chartMax=Math.max(...data.map(d=>Math.abs(d.resultado)),metaV,1);
  const maxAcumAbs=Math.max(...acumulado.map(d=>Math.abs(d.valor)),1);

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button className="op-btn" onClick={()=>setAno(a=>a-1)} style={{
            width:30,height:30,borderRadius:8,border:`1px solid ${C.border}`,background:C.input,
            color:C.muted,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }}><Icon name="chevron-left" size={15}/></button>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:C.text,fontFamily:"var(--font-mono)"}}>Performance {ano}</div>
            <div style={{fontSize:12,color:C.muted}}>Puxado das posições encerradas · Resultado vs Selic</div>
          </div>
          <button className="op-btn" onClick={()=>setAno(a=>a+1)} style={{
            width:30,height:30,borderRadius:8,border:`1px solid ${C.border}`,background:C.input,
            color:C.muted,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }}><Icon name="chevron-right" size={15}/></button>
        </div>
        <div style={{display:"flex",gap:10}}>
          <div>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600,marginBottom:3}}>Meta mensal (R$)</div>
            <input className="op-input" type="number" value={meta} onChange={e=>setMeta(e.target.value)} style={iS({width:120})}/>
          </div>
          <div>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600,marginBottom:3}}>Capital total (R$)</div>
            <input className="op-input" type="number" value={capital} onChange={e=>setCapital(e.target.value)} style={iS({width:130})}/>
          </div>
          <div>
            <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600,marginBottom:3}}>Selic anual (%)</div>
            <input className="op-input" type="number" value={selic} onChange={e=>setSelic(e.target.value)} style={iS({width:90})}/>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
        <Metric label="Resultado do Ano" value={`R$ ${totalRes.toFixed(2)}`} hi={totalRes>0?C.green:totalRes<0?C.red:C.muted}/>
        <Metric label="Retorno s/ Capital" value={`${retornoCapital.toFixed(2)}%`} hi={retornoCapital>0?C.green:retornoCapital<0?C.red:C.muted}/>
        <Metric label="Selic Atual (a.a.)" value={`${selicAnualV.toFixed(2)}%`} sub="taxa vigente, não acumulada" hi={C.muted}/>
        <Metric label="Meses c/ Meta Batida" value={`${acertos}/${mesesComDados.length}`}
          hi={acertos===mesesComDados.length&&acertos>0?C.green:acertos>0?C.yellow:C.muted}/>
        <Metric label="Média Mensal" value={mesesComDados.length>0?`R$ ${mediaMensal.toFixed(2)}`:"—"}
          hi={mesesComDados.length>0&&mediaMensal>0?C.green:C.muted}/>
      </div>

      {/* Gráfico de barras mensais */}
      <Card style={{marginBottom:16}}>
        <SectionTitle>Resultado Mensal vs Meta vs Selic</SectionTitle>
        <div style={{position:"relative",padding:"0 4px",marginTop:16}}>
          {metaV>0&&(
            <div style={{position:"absolute",left:0,right:0,bottom:`${Math.min(100,(metaV/chartMax)*100)}px`,
              borderTop:`1px dashed ${C.accent}77`,zIndex:1}}>
              <span style={{position:"absolute",right:0,top:-13,fontSize:9,color:C.accent,background:C.card,padding:"0 4px"}}>
                Meta R$ {metaV.toFixed(0)}
              </span>
            </div>
          )}
          <div style={{display:"flex",gap:4,alignItems:"flex-end",height:100}}>
            {data.map((d,i)=>{
              const h=Math.abs(d.resultado)/chartMax*100;
              const col=!d.hasData?C.input:d.resultado>=metaV?C.green:d.resultado>0?C.yellow:C.red;
              const selicH=(d.selicMes/chartMax)*100;
              return(
                <div key={i} style={{flex:1,display:"flex",gap:2,alignItems:"flex-end",height:"100%"}}>
                  <div style={{flex:1,background:col,borderRadius:"3px 3px 0 0",height:`${h}px`,minHeight:d.hasData?2:0,transition:"height 0.3s"}}/>
                  <div style={{width:3,background:C.accent+"66",borderRadius:"2px 2px 0 0",height:`${selicH}px`}}/>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:4,marginTop:4}}>
            {data.map((d,i)=>(
              <div key={i} style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,color:C.muted}}>{d.mes}</div>
                {d.hasData&&<div style={{fontSize:9,fontWeight:700,color:d.resultado>=metaV?C.green:d.resultado>0?C.yellow:C.red,fontFamily:"var(--font-mono)"}}>
                  {d.resultado>=0?"+":""}{d.resultado.toFixed(0)}
                </div>}
              </div>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:16,marginTop:12,fontSize:10,color:C.muted,flexWrap:"wrap"}}>
          <span>■ <span style={{color:C.green}}>Meta batida</span></span>
          <span>■ <span style={{color:C.yellow}}>Positivo</span></span>
          <span>■ <span style={{color:C.red}}>Negativo</span></span>
          <span>▌ <span style={{color:C.accent}}>Selic equiv.</span></span>
          <span>┄ <span style={{color:C.accent}}>Linha da meta</span></span>
        </div>
      </Card>

      {/* Acumulado do ano */}
      <Card style={{marginBottom:16}}>
        <SectionTitle>Acumulado do Ano</SectionTitle>
        <div style={{display:"flex",gap:4,alignItems:"flex-end",height:90,padding:"0 4px"}}>
          {acumulado.map((d,i)=>{
            const h=Math.abs(d.valor)/maxAcumAbs*80;
            const col=d.valor>=0?C.accent:C.red;
            return(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:"100%",height:80,display:"flex",alignItems:"flex-end"}}>
                  <div style={{width:"100%",background:col+"AA",borderRadius:"3px 3px 0 0",height:`${h}px`,minHeight:d.hasData?2:0,transition:"height 0.3s"}}/>
                </div>
                <div style={{fontSize:9,color:C.muted}}>{d.mes}</div>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:11,color:C.muted,marginTop:8}}>
          Saldo acumulado ao fim do ano: <span style={{color:totalRes>=0?C.green:C.red,fontWeight:700,fontFamily:"var(--font-mono)"}}>R$ {totalRes.toFixed(2)}</span>
        </div>
      </Card>

      {/* Tabela mensal */}
      <Card style={{marginBottom:16}}>
        <SectionTitle>Detalhe por Mês</SectionTitle>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              {["Mês","Resultado (R$)","Meta (R$)","Selic equi.","Bateu Meta?"].map(h=>(
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
                  {d.hasData?`R$ ${d.resultado.toFixed(2)}`:"—"}
                </td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted,fontFamily:"var(--font-mono)"}}>R$ {metaV.toFixed(0)}</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted,fontFamily:"var(--font-mono)"}}>{d.selicMes.toFixed(2)}%</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`}}>
                  {d.hasData?<Badge color={d.resultado>=metaV?C.green:C.red}>{d.resultado>=metaV?"SIM":"NÃO"}</Badge>:"—"}
                </td>
              </tr>
            ))}
            <tr style={{background:C.accent+"0F"}}>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:700,color:C.text}}>TOTAL</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:700,color:totalRes>=0?C.green:C.red,fontFamily:"var(--font-mono)"}}>R$ {totalRes.toFixed(2)}</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted}}>—</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted,fontFamily:"var(--font-mono)"}}>{selicAnualV.toFixed(2)}%</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,color:C.muted}}>
                {acertos}/{mesesComDados.length}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Ranking por ativo */}
      <Card>
        <SectionTitle>Resultado por Ativo</SectionTitle>
        {porAtivo.length===0?(
          <div style={{textAlign:"center",padding:24,color:C.muted,fontSize:12}}>Nenhuma posição encerrada em {ano}</div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>
                {["Ativo","Resultado (R$)","Distribuição"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",background:C.input,color:C.muted,textAlign:h==="Distribuição"?"left":"center",
                    fontSize:10,textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:700,border:`1px solid ${C.borderSoft}`}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porAtivo.map((a,i)=>{
                const w=Math.abs(a.resultado)/maxAtivoAbs*100;
                const col=a.resultado>=0?C.green:C.red;
                return(
                  <tr key={a.ativo} style={{background:i%2===0?C.card:"#151a26"}}>
                    <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:700,color:C.text}}>{a.ativo}</td>
                    <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.borderSoft}`,fontWeight:700,color:col,fontFamily:"var(--font-mono)"}}>
                      R$ {a.resultado.toFixed(2)}
                    </td>
                    <td style={{padding:"8px 10px",border:`1px solid ${C.borderSoft}`}}>
                      <div style={{background:C.input,borderRadius:6,height:8,overflow:"hidden"}}>
                        <div style={{width:`${w}%`,height:"100%",background:col,borderRadius:6,transition:"width 0.3s"}}/>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ABA 6 — PREÇO TETO
// ════════════════════════════════════════════════════════════════════
const SETORES_DB={
  BBAS3:{setor:"Banco",pl:8},ITUB4:{setor:"Banco",pl:9},
  BBDC4:{setor:"Banco",pl:8},SANB11:{setor:"Banco",pl:8},
  BRSR6:{setor:"Banco",pl:7},BPAC11:{setor:"Banco",pl:10},
  EGIE3:{setor:"Energia elétrica",pl:13},TAEE11:{setor:"Energia elétrica",pl:12},
  ENGI11:{setor:"Energia elétrica",pl:12},CPFE3:{setor:"Energia elétrica",pl:13},
  ENBR3:{setor:"Energia elétrica",pl:13},EQTL3:{setor:"Energia elétrica",pl:14},
  CPLE6:{setor:"Energia elétrica",pl:11},TRPL4:{setor:"Energia elétrica",pl:11},
  AURE3:{setor:"Energia elétrica",pl:12},
  SAPR11:{setor:"Saneamento",pl:14},CSMG3:{setor:"Saneamento",pl:13},
  VIVT3:{setor:"Telecom",pl:14},TIMS3:{setor:"Telecom",pl:15},
  PETR4:{setor:"Petróleo (cíclico)",pl:5},PETR3:{setor:"Petróleo (cíclico)",pl:5},
  PRIO3:{setor:"Petróleo (cíclico)",pl:6},RECV3:{setor:"Petróleo (cíclico)",pl:5},
  CSAN3:{setor:"Petróleo (cíclico)",pl:7},
  VALE3:{setor:"Mineração (cíclico)",pl:5},CSNA3:{setor:"Siderurgia (cíclico)",pl:6},
  GGBR4:{setor:"Siderurgia (cíclico)",pl:6},
  BBSE3:{setor:"Seguros",pl:12},PSSA3:{setor:"Seguros",pl:13},
  ABEV3:{setor:"Bebidas",pl:16},WEGE3:{setor:"Máquinas industriais",pl:28},
  RENT3:{setor:"Locação de veículos",pl:12},VBBR3:{setor:"Distribuição combustível",pl:10},
  SUZB3:{setor:"Papel e celulose (cíclico)",pl:7},KLBN11:{setor:"Papel e celulose (cíclico)",pl:8},
  TAEE3:{setor:"Energia elétrica",pl:12},CMIG4:{setor:"Energia elétrica",pl:11},
};

const SETORES_CICLICOS=["cíclico","mineração","petróleo","siderurgia","papel","celulose","varejo"];
const isCiclico=(setor)=>setor&&SETORES_CICLICOS.some(s=>setor.toLowerCase().includes(s));

// ── 4 metodologias de preço teto ──
function calcMetodologias({preco,lpa,vpa,dividendo,plSetor,yieldMin}){
  const resultados=[];

  if(dividendo>0&&yieldMin>0){
    const teto=dividendo/(yieldMin/100);
    const margem=((teto-preco)/teto)*100;
    const dy=(dividendo/preco)*100;
    resultados.push({id:"bazin",nome:"Método Bazin",teto,margem,
      formula:`Dividendo ÷ ${yieldMin}%`,
      detalhe:`R$ ${dividendo.toFixed(2)} ÷ ${yieldMin}% = R$ ${teto.toFixed(2)}`,
      nota:`DY atual ao preço: ${dy.toFixed(2)}%`,peso:2});
  }

  if(lpa>0&&vpa>0){
    const teto=Math.sqrt(22.5*lpa*vpa);
    const margem=((teto-preco)/teto)*100;
    resultados.push({id:"graham",nome:"Fórmula de Graham",teto,margem,
      formula:"√(22,5 × LPA × VPA)",
      detalhe:`√(22,5 × ${lpa.toFixed(2)} × ${vpa.toFixed(2)}) = R$ ${teto.toFixed(2)}`,
      nota:"Preço justo pelo lucro e patrimônio",peso:2});
  }

  if(lpa>0&&plSetor>0){
    const teto=lpa*plSetor;
    const margem=((teto-preco)/teto)*100;
    resultados.push({id:"pl",nome:"P/L Setorial",teto,margem,
      formula:"LPA × P/L médio do setor",
      detalhe:`${lpa.toFixed(2)} × ${plSetor} = R$ ${teto.toFixed(2)}`,
      nota:`P/L médio do setor: ${plSetor}×`,peso:1});
  }

  if(vpa>0){
    const teto=vpa*1.5;
    const margem=((teto-preco)/teto)*100;
    resultados.push({id:"vpa",nome:"Valor Patrimonial",teto,margem,
      formula:"VPA × 1,5",
      detalhe:`${vpa.toFixed(2)} × 1,5 = R$ ${teto.toFixed(2)}`,
      nota:"Múltiplo de book value — Graham",peso:1});
  }

  if(!resultados.length) return null;

  const somaPesos=resultados.reduce((a,r)=>a+r.peso,0);
  const tetoMedio=resultados.reduce((a,r)=>a+r.teto*r.peso,0)/somaPesos;
  const margemMedia=((tetoMedio-preco)/tetoMedio)*100;

  const baratos=resultados.filter(r=>r.margem>=15).length;
  const caros=resultados.filter(r=>r.margem<0).length;
  let consenso,consensoCor;
  if(baratos>=3){consenso="COMPRAR";consensoCor=C.green;}
  else if(baratos>=2){consenso="MONITORAR";consensoCor=C.yellow;}
  else if(caros>=3){consenso="CARO";consensoCor=C.red;}
  else{consenso="NEUTRO";consensoCor=C.orange;}

  return{resultados,tetoMedio,margemMedia,consenso,consensoCor};
}

function getLabelMetodo(margem){
  if(margem>=20) return{label:"BARATO",color:C.green};
  if(margem>=5) return{label:"JUSTO",color:C.yellow};
  if(margem>=0) return{label:"NEUTRO",color:C.orange};
  return{label:"CARO",color:C.red};
}

const CHECKLIST=[
  {id:"div5anos",cat:"Dividendos",label:"Paga dividendos há 5+ anos consecutivos?",peso:2,auto:false,
    dica:"Verifique se há proventos em todos os anos recentes",
    fonte:t=>`https://statusinvest.com.br/acoes/${t.toLowerCase()}`},
  {id:"payoutOk",cat:"Dividendos",label:"Payout sustentável (abaixo de 80%)?",peso:2,auto:true,
    dica:"Payout = dividendo ÷ LPA. Acima de 100% é insustentável",
    fonte:t=>`https://statusinvest.com.br/acoes/${t.toLowerCase()}`},
  {id:"lucroEst",cat:"Fundamentos",label:"Lucro não caiu mais de 20% em nenhum dos últimos 3 anos?",peso:2,auto:false,
    dica:"Veja o gráfico de Lucro Líquido — quedas bruscas = instabilidade",
    fonte:t=>`https://statusinvest.com.br/acoes/${t.toLowerCase()}`},
  {id:"roeOk",cat:"Fundamentos",label:"ROE acima de 10%?",peso:1,auto:false,
    dica:"ROE = retorno sobre patrimônio. Bancos costumam ter 15-20%+",
    fonte:t=>`https://statusinvest.com.br/acoes/${t.toLowerCase()}`},
  {id:"dividaOk",cat:"Fundamentos",label:"Dívida líquida/EBITDA abaixo de 2,5×?",peso:1,auto:false,
    dica:"Utilities (energia, saneamento) aceitam até 3-4×",
    fonte:t=>`https://statusinvest.com.br/acoes/${t.toLowerCase()}`},
  {id:"setorPer",cat:"Qualitativo",label:"Setor perene ou com vantagem competitiva clara?",peso:1,auto:true,
    dica:"Energia, banco, saneamento, telecom = perene. Mineração, varejo = cíclico",
    fonte:null},
];

function gerarRessalvas({setor,payoutCalc,margemMedia,metodos,checklist}){
  const r=[];
  if(isCiclico(setor))
    r.push({tipo:"warn",texto:`Setor cíclico (${setor}) — dividendo oscila com o ciclo. Use média de 5+ anos de dividendos no Método Bazin, não o último ano isolado`});
  if(payoutCalc&&parseFloat(payoutCalc)>100)
    r.push({tipo:"bad",texto:`Payout de ${payoutCalc}% — empresa distribui mais do que ganha. Dividendo provavelmente insustentável nesse patamar`});
  if(metodos){
    const bazin=metodos.find(m=>m.id==="bazin");
    const graham=metodos.find(m=>m.id==="graham");
    if(bazin&&graham&&Math.abs(bazin.teto-graham.teto)/Math.max(bazin.teto,graham.teto)>0.4)
      r.push({tipo:"warn",texto:`Grande divergência entre Bazin (R$ ${bazin.teto.toFixed(2)}) e Graham (R$ ${graham.teto.toFixed(2)}) — analise se o dividendo informado é representativo`});
  }
  if(margemMedia<10&&margemMedia>=0)
    r.push({tipo:"warn",texto:`Margem de segurança média de apenas ${margemMedia.toFixed(0)}% — ideal é comprar com 15-20% de folga`});
  r.push({tipo:"info",texto:"Preço teto é o valor máximo a pagar para cada metodologia — não garante retorno futuro. Use como filtro de entrada, não como alvo de preço"});
  checklist.forEach(item=>{if(item.resposta===false) r.push({tipo:"bad",texto:item.label});});
  return r;
}

const FEEDBACK_ICON={
  positive:{icon:"check",color:C.green},
  wait:{icon:"clock",color:C.yellow},
  negative:{icon:"x",color:C.red},
  mixed:{icon:"bars",color:C.accent},
  "quality-high":{icon:"star",color:C.green},
  "quality-mid":{icon:"check",color:C.yellow},
  "quality-low":{icon:"alert",color:C.red},
  cyclical:{icon:"refresh",color:C.yellow},
  stable:{icon:"shield",color:C.green},
  action:{icon:"zap",color:C.accent},
  dispersion:{icon:"bars",color:C.muted},
};

function gerarFeedback({consenso,notaChecklist,margemMedia,setor,metodos}){
  const linhas=[];

  if(consenso==="COMPRAR") linhas.push({kind:"positive",texto:"Preço está abaixo do teto pela maioria das metodologias — janela de entrada favorável"});
  else if(consenso==="MONITORAR") linhas.push({kind:"wait",texto:"Preço está próximo do teto em parte das metodologias — aguarde uma queda para melhor relação risco/retorno"});
  else if(consenso==="CARO") linhas.push({kind:"negative",texto:"Preço está acima do teto pela maioria das metodologias — não é momento de comprar"});
  else linhas.push({kind:"mixed",texto:"Metodologias divergem — sem consenso claro de preço. Analise qual metodologia faz mais sentido para o setor"});

  if(notaChecklist!==null){
    if(notaChecklist>=80) linhas.push({kind:"quality-high",texto:"Ativo de alta qualidade — fundamentos sólidos, histórico de dividendos consistente"});
    else if(notaChecklist>=60) linhas.push({kind:"quality-mid",texto:"Ativo com qualidade razoável — alguns critérios a monitorar antes de montar posição grande"});
    else linhas.push({kind:"quality-low",texto:"Ativo com fundamentos frágeis — risco elevado mesmo se o preço estiver no teto"});
  }

  if(isCiclico(setor)) linhas.push({kind:"cyclical",texto:`Setor cíclico (${setor}) — dividendo oscila com commodity/ciclo. Ideal para swing de preço, menos ideal para renda recorrente`});
  else if(setor) linhas.push({kind:"stable",texto:`Setor perene (${setor}) — mais previsível para estratégia de renda com lançamento coberto`});

  if(consenso==="COMPRAR"&&notaChecklist!==null&&notaChecklist>=70)
    linhas.push({kind:"action",texto:"Condições favoráveis para montar posição e iniciar lançamento coberto"});
  else if(consenso==="CARO")
    linhas.push({kind:"action",texto:"Se já tem o ativo em carteira, o lançamento coberto ainda pode fazer sentido — mas não é momento de ampliar a posição no ativo"});
  else
    linhas.push({kind:"action",texto:"Para lançamento coberto: aguarde melhor preço de entrada antes de ampliar posição no ativo base"});

  if(metodos&&metodos.length>=2){
    const max=Math.max(...metodos.map(m=>m.teto));
    const min=Math.min(...metodos.map(m=>m.teto));
    if((max-min)/max>0.5)
      linhas.push({kind:"dispersion",texto:`Alta dispersão entre as metodologias (R$ ${min.toFixed(0)} a R$ ${max.toFixed(0)}) — use o preço teto médio como referência principal`});
  }

  return linhas;
}

function TabPrecoTeto(){
  const [ticker,setTicker]=useState("ITUB4");
  const [fetchStatus,setFetchStatus]=useState("idle");
  const [cotacao,setCotacao]=useState("");
  const [lpa,setLpa]=useState("");
  const [vpa,setVpa]=useState("");
  const [dividendo,setDividendo]=useState("");
  const [plSetor,setPlSetor]=useState("");
  const [setorNome,setSetorNome]=useState("");
  const [yieldMin,setYieldMin]=useState("6");
  const [roe,setRoe]=useState("");
  const [dividaEbitda,setDividaEbitda]=useState("");
  const [respostas,setRespostas]=useState({});
  const [expandedDica,setExpandedDica]=useState(null);
  const [result,setResult]=useState(null);
  const [ativosDB,setAtivosDB]=useState({});
  const [dbLoaded,setDbLoaded]=useState(false);
  const [payoutCalc,setPayoutCalc]=useState("");

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

  // Payout automático
  useEffect(()=>{
    if(dividendo&&lpa&&parseFloat(lpa)>0){
      const p=(parseFloat(dividendo)/parseFloat(lpa)*100).toFixed(0);
      setPayoutCalc(p);
      setRespostas(r=>({...r,payoutOk:parseFloat(p)<=80}));
    }else{
      setPayoutCalc("");
    }
  },[dividendo,lpa]);

  // Setor automático
  useEffect(()=>{
    const db=SETORES_DB[ticker];
    if(db){
      setSetorNome(db.setor);
      setPlSetor(String(db.pl));
      setRespostas(r=>({...r,setorPer:!isCiclico(db.setor)}));
    }else{
      setSetorNome("");setPlSetor("");
      setRespostas(r=>{const nr={...r};delete nr.setorPer;return nr;});
    }
  },[ticker]);

  const carregarAtivo=useCallback((tick)=>{
    const saved=ativosDB[tick];
    if(saved){
      setRoe(saved.roe||"");
      setDividaEbitda(saved.dividaEbitda||"");
      setDividendo(saved.dividendo||"");
    }else{
      setRoe("");setDividaEbitda("");
    }
    // Preserva payoutOk/setorPer já recalculados para o novo ticker.
    setRespostas(r=>{
      const merged={...(saved?.respostas||{})};
      if(r.payoutOk!==undefined) merged.payoutOk=r.payoutOk;
      if(r.setorPer!==undefined) merged.setorPer=r.setorPer;
      return merged;
    });
    setResult(null);
  },[ativosDB]);

  const buscarDados=useCallback(async(tick)=>{
    if(!tick||tick.length<4) return;
    setFetchStatus("loading");
    setCotacao("");setLpa("");setVpa("");setDividendo("");
    try{
      const r=await fetch(`/api/brapi/${tick}?stats=1`);
      const d=await r.json();
      if(d.price){
        setCotacao(String(d.price));
        if(typeof d.eps==="number") setLpa(d.eps.toFixed(2));
        if(typeof d.vpa==="number") setVpa(d.vpa.toFixed(2));
        if(typeof d.dividendYield==="number"){
          const divEst=(d.price*d.dividendYield/100).toFixed(2);
          setDividendo(prev=>prev||divEst);
        }
        setFetchStatus("ok");
      }else{
        setFetchStatus("error");
      }
    }catch{
      setFetchStatus("error");
    }
  },[]);

  useEffect(()=>{
    if(!ticker||ticker.length<4) return;
    const t=setTimeout(()=>{buscarDados(ticker);carregarAtivo(ticker);},900);
    return()=>clearTimeout(t);
  },[ticker,dbLoaded]);

  const salvar=()=>{
    setAtivosDB(db=>({...db,[ticker]:{roe,dividaEbitda,dividendo,respostas}}));
  };

  const setResp=(id,val)=>{setRespostas(r=>({...r,[id]:val}));setResult(null);};

  const analisar=()=>{
    const preco=parseFloat(cotacao),lpaV=parseFloat(lpa),vpaV=parseFloat(vpa);
    const divV=parseFloat(dividendo),ymV=parseFloat(yieldMin),plV=parseFloat(plSetor);
    if(!preco){alert("Cotação não encontrada — verifique o ticker.");return;}
    if(!lpaV&&!divV){alert("Preencha pelo menos LPA ou Dividendo anual.");return;}

    const calc=calcMetodologias({preco,lpa:lpaV||0,vpa:vpaV||0,dividendo:divV||0,plSetor:plV||0,yieldMin:ymV});
    if(!calc){alert("Dados insuficientes para calcular.");return;}

    const itens=CHECKLIST.map(i=>({...i,resposta:respostas[i.id]}));
    const pesoTotal=CHECKLIST.reduce((a,b)=>a+b.peso,0);
    const pesoObt=itens.reduce((a,i)=>i.resposta===true?a+i.peso:a,0);
    const respondidos=itens.filter(i=>i.resposta!==undefined).length;
    const nota=respondidos>0?(pesoObt/pesoTotal*100):null;
    const notaLabel=nota===null?"INCOMPLETO":nota>=80?"APROVADO":nota>=60?"ATENÇÃO":"REPROVADO";
    const notaCor=nota===null?C.muted:nota>=80?C.green:nota>=60?C.yellow:C.red;

    const ressalvas=gerarRessalvas({setor:setorNome,payoutCalc,margemMedia:calc.margemMedia,metodos:calc.resultados,checklist:itens});
    const feedback=gerarFeedback({consenso:calc.consenso,notaChecklist:nota,margemMedia:calc.margemMedia,setor:setorNome,metodos:calc.resultados});

    setResult({calc,nota,notaLabel,notaCor,ressalvas,feedback,preco,itens,pesoObt,pesoTotal,respondidos});
  };

  const porCat=["Dividendos","Fundamentos","Qualitativo"].map(cat=>({cat,items:CHECKLIST.filter(i=>i.cat===cat)}));

  return(
    <div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text}}>Preço Teto</div>
        <div style={{fontSize:12,color:C.muted}}>4 metodologias · Checklist de qualidade · Análise para tomada de decisão</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"270px 1fr",gap:20,alignItems:"start"}}>
        {/* Coluna esquerda */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card>
            <SectionTitle>Ativo</SectionTitle>
            <Fld label="Ticker">
              <input className="op-input" value={ticker} onChange={e=>{setTicker(e.target.value.toUpperCase());setResult(null);}}
                placeholder="Ex: PETR4, ITUB4..." style={iS({fontSize:14,fontWeight:600})}/>
            </Fld>

            <div style={{background:C.input,borderRadius:10,padding:11,border:`1px solid ${C.borderSoft}`}}>
              <div style={{fontSize:9.5,color:C.green,fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.5px"}}>● Brapi — automático</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[{l:"Cotação",v:cotacao?`R$ ${cotacao}`:"—"},{l:"LPA (EPS)",v:lpa?`R$ ${lpa}`:"—"},
                  {l:"VPA",v:vpa?`R$ ${vpa}`:"—"},{l:"Setor",v:setorNome||"—"},
                  {l:"P/L setor",v:plSetor?`${plSetor}×`:"—"}].map(({l,v})=>(
                  <div key={l}>
                    <div style={{fontSize:9,color:C.muted}}>{l}</div>
                    <div style={{fontSize:12,fontWeight:600,color:fetchStatus==="ok"?C.text:C.muted,lineHeight:1.3,fontFamily:"var(--font-mono)"}}>{v}</div>
                  </div>
                ))}
                {payoutCalc&&(
                  <div>
                    <div style={{fontSize:9,color:C.muted}}>Payout</div>
                    <div style={{fontSize:12,fontWeight:600,color:parseFloat(payoutCalc)<=80?C.green:parseFloat(payoutCalc)<=100?C.yellow:C.red,fontFamily:"var(--font-mono)"}}>{payoutCalc}%</div>
                  </div>
                )}
              </div>
              {fetchStatus==="loading"&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Buscando...</div>}
              {fetchStatus==="error"&&<div style={{fontSize:11,color:C.red,marginTop:6}}>Não encontrado</div>}
            </div>
            <Btn onClick={()=>buscarDados(ticker)} variant="secondary" style={{width:"100%",marginTop:10,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <Icon name="refresh" size={13}/> Atualizar
            </Btn>
          </Card>

          <Card>
            <SectionTitle>Dados <span style={{fontWeight:400,fontSize:10,textTransform:"none"}}>(confirme ou edite)</span></SectionTitle>

            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>Dividendo anual / ação (R$)</div>
                <ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Confirmar</ExtLink>
              </div>
              <div style={{position:"relative"}}>
                <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>R$</span>
                <input className="op-input" type="number" value={dividendo} onChange={e=>{setDividendo(e.target.value);setResult(null);}}
                  placeholder="Soma dos últimos 12 meses" style={iS({paddingLeft:26,border:`1px solid ${C.yellow}44`,background:C.yellow+"0A"})}/>
              </div>
              <div style={{fontSize:10,color:C.yellow,marginTop:4,display:"flex",alignItems:"center",gap:4}}>
                <Icon name="alert" size={11}/> Confirme no Status Invest — APIs podem ter valores incorretos
              </div>
            </div>

            <Fld label="Yield mínimo — Método Bazin (%)">
              <div style={{position:"relative"}}>
                <input className="op-input" type="number" value={yieldMin} onChange={e=>{setYieldMin(e.target.value);setResult(null);}}
                  placeholder="6" style={iS({paddingRight:22,border:`1px solid ${C.accent}44`,background:C.accent+"0D"})}/>
                <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",color:C.accent,fontSize:12}}>%</span>
              </div>
            </Fld>

            <Fld label="P/L médio do setor" hint={!SETORES_DB[ticker]?"Ativo não mapeado — preencha manualmente":undefined}>
              <input className="op-input" type="number" value={plSetor} onChange={e=>{setPlSetor(e.target.value);setResult(null);}}
                placeholder="Ex: 9 para bancos" style={iS({border:plSetor?`1px solid ${C.green}44`:undefined,background:plSetor?C.green+"0A":C.input})}/>
            </Fld>
          </Card>

          <Card style={{border:`1px solid ${C.borderSoft}`}}>
            <SectionTitle>Campos manuais</SectionTitle>
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>ROE (%)</div>
                <ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Status Invest</ExtLink>
              </div>
              <div style={{position:"relative"}}>
                <input className="op-input" type="number" value={roe} onChange={e=>setRoe(e.target.value)}
                  placeholder="Acima de 10% é bom" style={iS({paddingRight:22})}/>
                <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>%</span>
              </div>
              {roe&&(
                <div style={{fontSize:10,marginTop:4,color:parseFloat(roe)>=15?C.green:parseFloat(roe)>=10?C.yellow:C.red,display:"flex",alignItems:"center",gap:4}}>
                  <Icon name={parseFloat(roe)>=10?"check":"x"} size={11}/> {parseFloat(roe)>=15?"Excelente":parseFloat(roe)>=10?"Bom":"Abaixo do esperado"}
                </div>
              )}
            </div>
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.6px",fontWeight:600}}>Dívida líq./EBITDA</div>
                <ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Status Invest</ExtLink>
              </div>
              <input className="op-input" type="number" value={dividaEbitda} onChange={e=>setDividaEbitda(e.target.value)}
                placeholder="Abaixo de 2,5 é saudável" style={iS()}/>
              {dividaEbitda&&(
                <div style={{fontSize:10,marginTop:4,color:parseFloat(dividaEbitda)<=2?C.green:parseFloat(dividaEbitda)<=2.5?C.yellow:C.red,display:"flex",alignItems:"center",gap:4}}>
                  <Icon name={parseFloat(dividaEbitda)<=2.5?"check":"x"} size={11}/> {parseFloat(dividaEbitda)<=2?"Confortável":parseFloat(dividaEbitda)<=2.5?"Aceitável":"Elevado"}
                </div>
              )}
            </div>
            <Btn onClick={salvar} variant="secondary" style={{width:"100%",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <Icon name="save" size={13}/> Salvar dados de {ticker}
            </Btn>
          </Card>

          <Btn onClick={analisar} style={{width:"100%",padding:"12px"}} variant="primary">Analisar →</Btn>
        </div>

        {/* Coluna direita */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {result?(
            <>
              {/* Preço teto médio — hero card */}
              <div style={{
                background:`linear-gradient(135deg, ${result.calc.consensoCor}18, ${C.card})`,
                border:`1px solid ${result.calc.consensoCor}55`,
                borderRadius:16,padding:"20px 24px",
                boxShadow:`0 8px 24px ${result.calc.consensoCor}14`
              }}>
                <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>
                  Pelas {result.calc.resultados.length} metodologias, o preço teto médio é
                </div>
                <div style={{fontSize:40,fontWeight:800,color:C.text,lineHeight:1,marginBottom:12,fontFamily:"var(--font-mono)"}}>
                  R$ {result.calc.tetoMedio.toFixed(2)}
                </div>
                <div style={{display:"flex",gap:20,flexWrap:"wrap",marginBottom:12}}>
                  <div style={{fontSize:13,color:C.muted}}>
                    Preço atual <span style={{color:C.text,fontWeight:600,fontFamily:"var(--font-mono)"}}>R$ {result.preco.toFixed(2)}</span>
                  </div>
                  <div style={{fontSize:13,color:C.muted}}>
                    Margem de segurança <span style={{
                      color:result.calc.margemMedia>=15?C.green:result.calc.margemMedia>=0?C.yellow:C.red,
                      fontWeight:700,fontFamily:"var(--font-mono)"
                    }}>{result.calc.margemMedia.toFixed(1)}%</span>
                  </div>
                </div>
                <div style={{display:"inline-flex",alignItems:"center",gap:8,background:result.calc.consensoCor+"22",
                  border:`1px solid ${result.calc.consensoCor}44`,borderRadius:20,padding:"4px 14px"}}>
                  <span style={{fontSize:11,color:C.muted}}>Recomendação consensual</span>
                  <span style={{fontSize:13,fontWeight:700,color:result.calc.consensoCor}}>{result.calc.consenso}</span>
                </div>
              </div>

              {/* 4 caixinhas de metodologia */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
                {result.calc.resultados.map(m=>{
                  const {label,color}=getLabelMetodo(m.margem);
                  return(
                    <div key={m.id} style={{background:color+"0A",border:`1px solid ${color}33`,borderRadius:12,padding:"14px 16px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.text}}>{m.nome}</div>
                        <Badge color={color}>{label}</Badge>
                      </div>
                      <div style={{fontSize:24,fontWeight:800,color:C.text,marginBottom:4,fontFamily:"var(--font-mono)"}}>R$ {m.teto.toFixed(2)}</div>
                      <div style={{fontSize:11,color,fontWeight:600,marginBottom:4}}>Margem: {m.margem.toFixed(1)}%</div>
                      <div style={{fontSize:10,color:C.muted,fontFamily:"var(--font-mono)",marginBottom:2}}>{m.formula}</div>
                      <div style={{fontSize:10,color:C.muted}}>{m.nota}</div>
                    </div>
                  );
                })}
              </div>

              {/* Checklist compacto */}
              <Card>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <SectionTitle>Checklist de Qualidade</SectionTitle>
                  {result.nota!==null&&(
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{fontSize:18,fontWeight:800,color:result.notaCor,fontFamily:"var(--font-mono)"}}>{result.nota.toFixed(0)}%</div>
                      <Badge color={result.notaCor}>{result.notaLabel}</Badge>
                    </div>
                  )}
                </div>
                <div style={{background:C.input,borderRadius:8,height:6,overflow:"hidden",marginBottom:14}}>
                  <div style={{width:`${result.nota||0}%`,height:"100%",
                    background:result.nota>=80?C.green:result.nota>=60?C.yellow:C.red,
                    borderRadius:8,transition:"width 0.5s"}}/>
                </div>
                {result.itens.map(item=>{
                  const resp=item.resposta;
                  return(
                    <div key={item.id} style={{
                      display:"flex",alignItems:"center",justifyContent:"space-between",
                      padding:"9px 11px",borderRadius:9,marginBottom:6,
                      background:resp===true?C.green+"0A":resp===false?C.red+"0A":C.input,
                      border:`1px solid ${resp===true?C.green+"33":resp===false?C.red+"33":C.borderSoft}`
                    }}>
                      <div style={{display:"flex",alignItems:"center",gap:9,flex:1}}>
                        <span style={{flexShrink:0,color:resp===true?C.green:resp===false?C.red:C.muted}}>
                          <Icon name={resp===true?"check":resp===false?"x":"circle"} size={15}/>
                        </span>
                        <div>
                          <div style={{fontSize:12,color:C.text}}>{item.label}</div>
                          {item.id==="payoutOk"&&payoutCalc&&(
                            <div style={{fontSize:10,color:C.accent2}}>Calculado: {payoutCalc}%</div>
                          )}
                          {item.id==="setorPer"&&setorNome&&(
                            <div style={{fontSize:10,color:isCiclico(setorNome)?C.yellow:C.green}}>Setor detectado: {setorNome}</div>
                          )}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:4,flexShrink:0}}>
                        {[{l:"S",v:true,c:C.green},{l:"N",v:false,c:C.red}].map(({l,v,c})=>(
                          <button key={l} className="op-btn" onClick={()=>setResp(item.id,v)} style={{
                            width:26,height:26,borderRadius:7,
                            border:`1px solid ${resp===v?c:C.border}`,
                            background:resp===v?c+"22":"transparent",
                            color:resp===v?c:C.muted,cursor:"pointer",fontSize:11,fontWeight:700
                          }}>{l}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </Card>

              {/* Feedback qualitativo */}
              <Card style={{background:`linear-gradient(135deg, ${C.accent}0A, ${C.card})`}}>
                <SectionTitle color={C.accent}>Análise para Tomada de Decisão</SectionTitle>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {result.feedback.map((f,i)=>{
                    const fi=FEEDBACK_ICON[f.kind]||FEEDBACK_ICON.mixed;
                    return(
                      <div key={i} style={{display:"flex",gap:10,padding:"10px 12px",borderRadius:9,
                        background:C.input,border:`1px solid ${C.borderSoft}`}}>
                        <span style={{flexShrink:0,color:fi.color,marginTop:1}}><Icon name={fi.icon} size={15}/></span>
                        <span style={{fontSize:12.5,color:C.text,lineHeight:1.5}}>{f.texto}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Ressalvas */}
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
            <>
              {/* Checklist sempre visível mesmo sem resultado */}
              <Card>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <SectionTitle>Checklist de Qualidade</SectionTitle>
                  <ExtLink href={`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`}>Status Invest</ExtLink>
                </div>
                {porCat.map(({cat,items})=>(
                  <div key={cat} style={{marginBottom:14}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8,
                      paddingBottom:4,borderBottom:`1px solid ${C.borderSoft}`}}>{cat.toUpperCase()}</div>
                    {items.map(item=>{
                      const resp=respostas[item.id];
                      const isExp=expandedDica===item.id;
                      return(
                        <div key={item.id} style={{borderRadius:10,marginBottom:6,
                          background:resp===true?C.green+"0A":resp===false?C.red+"0A":C.input,
                          border:`1px solid ${resp===true?C.green+"33":resp===false?C.red+"33":C.borderSoft}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:9,padding:"9px 11px"}}>
                            <span style={{flexShrink:0,color:resp===true?C.green:resp===false?C.red:C.muted}}>
                              <Icon name={resp===true?"check":resp===false?"x":"circle"} size={15}/>
                            </span>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,color:C.text}}>{item.label}</div>
                              {item.id==="payoutOk"&&payoutCalc&&(
                                <div style={{fontSize:10,color:C.accent2}}>Calculado: {payoutCalc}%</div>
                              )}
                              {item.id==="setorPer"&&setorNome&&(
                                <div style={{fontSize:10,color:isCiclico(setorNome)?C.yellow:C.green}}>Setor: {setorNome}</div>
                              )}
                            </div>
                            <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
                              <button className="op-btn" onClick={()=>setExpandedDica(isExp?null:item.id)} style={{
                                padding:"3px 8px",borderRadius:7,border:`1px solid ${isExp?C.accent:C.border}`,
                                background:isExp?C.accent+"14":"transparent",color:isExp?C.accent:C.muted,
                                cursor:"pointer",fontSize:10
                              }}>{isExp?"▲":"▼"}</button>
                              {[{l:"S",v:true,c:C.green},{l:"N",v:false,c:C.red}].map(({l,v,c})=>(
                                <button key={l} className="op-btn" onClick={()=>setResp(item.id,v)} style={{
                                  width:26,height:26,borderRadius:7,
                                  border:`1px solid ${resp===v?c:C.border}`,
                                  background:resp===v?c+"22":"transparent",
                                  color:resp===v?c:C.muted,cursor:"pointer",fontSize:11,fontWeight:700
                                }}>{l}</button>
                              ))}
                            </div>
                          </div>
                          {isExp&&(
                            <div style={{padding:"9px 11px 11px",borderTop:`1px solid ${C.borderSoft}`,borderRadius:"0 0 10px 10px"}}>
                              <div style={{display:"flex",gap:6,fontSize:11,color:C.muted,marginBottom:6,lineHeight:1.5}}>
                                <Icon name="info" size={13} style={{flexShrink:0,marginTop:1}}/> {item.dica}
                              </div>
                              {item.fonte
                                ?<ExtLink href={item.fonte(ticker)}>Status Invest — {item.cat}</ExtLink>
                                :<div style={{fontSize:10,color:C.muted}}>Avaliação subjetiva</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </Card>

              <EmptyState icon="target" title="Digite o ticker e clique em Analisar" desc={
                <span style={{display:"block",lineHeight:1.9,textAlign:"left"}}>
                  <span style={{display:"block"}}><span style={{color:C.green}}>●</span> Cotação, LPA, VPA, setor e P/L setorial — automático</span>
                  <span style={{display:"block"}}><span style={{color:C.accent2}}>●</span> Payout e setor perene — calculados</span>
                  <span style={{display:"block"}}><span style={{color:C.yellow}}>●</span> Dividendo anual — confirme no Status Invest</span>
                  <span style={{display:"block"}}><span style={{color:C.muted}}>●</span> ROE e Dívida/EBITDA — 2 campos manuais</span>
                </span>
              }/>
            </>
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
  {id:"rolagem",label:"Rolagem",icon:"refresh",comp:TabRolagem},
  {id:"precoteto",label:"Preço Teto",icon:"target",comp:TabPrecoTeto},
  {id:"posicoes",label:"Posições",icon:"clipboard",comp:TabPosicoes},
  {id:"performance",label:"Performance",icon:"trending",comp:TabPerformance},
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
