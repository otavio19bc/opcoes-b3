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
async function fetchQuote(ticker){
  const r=await fetch(`https://brapi.dev/api/quote/${ticker}?token=anonymous`);
  const d=await r.json();
  return d?.results?.[0]?.regularMarketPrice||null;
}

async function fetchHistPrices(ticker){
  const r=await fetch(`https://brapi.dev/api/quote/${ticker}?range=3mo&interval=1d&token=anonymous`);
  const d=await r.json();
  const hist=d?.results?.[0]?.historicalDataPrice||[];
  return hist.map(h=>h.close).filter(Boolean);
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
  const col=score>=4?"#3FB950":score>=2?"#D29922":score>=0?"#F0883E":"#F85149";
  return{verdict:v,color:col,score,signals,sp};
}

// ════════════════════════════════════════════════════════════════════
// COLORS & BASE COMPONENTS
// ════════════════════════════════════════════════════════════════════
const C={bg:"#0D1117",card:"#161B22",border:"#30363D",accent:"#58A6FF",
  green:"#3FB950",yellow:"#D29922",orange:"#F0883E",red:"#F85149",
  text:"#E6EDF3",muted:"#8B949E",input:"#21262D"};

const iS=(extra={})=>({width:"100%",background:C.input,border:`1px solid ${C.border}`,
  borderRadius:6,padding:"8px 10px",color:C.text,fontSize:13,outline:"none",
  boxSizing:"border-box",fontFamily:"'JetBrains Mono',monospace",...extra});

function Fld({label,children,hint}){
  return(
    <div style={{marginBottom:10}}>
      <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</div>
      {children}
      {hint&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{hint}</div>}
    </div>
  );
}

function Card({children,style={}}){
  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,...style}}>{children}</div>;
}

function SectionTitle({children}){
  return <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:12}}>{children}</div>;
}

function Metric({label,value,sub,hi}){
  return(
    <div style={{background:C.card,border:`1px solid ${hi?hi+"44":C.border}`,borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:3}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700,color:hi||C.text,fontFamily:"'JetBrains Mono',monospace"}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>{sub}</div>}
    </div>
  );
}

function Sig({t,text}){
  const col=t==="ok"?C.green:t==="warn"?C.yellow:C.red;
  const ic=t==="ok"?"✓":t==="warn"?"⚠":"✗";
  return(
    <div style={{display:"flex",gap:8,padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
      <span style={{color:col,fontSize:13,flexShrink:0,marginTop:1}}>{ic}</span>
      <span style={{fontSize:12,color:C.text,lineHeight:1.4}}>{text}</span>
    </div>
  );
}

function Btn({onClick,children,variant="primary",style={}}){
  const base={border:"none",borderRadius:7,fontSize:13,fontWeight:600,cursor:"pointer",padding:"9px 16px",...style};
  const v={primary:{background:C.accent,color:"#fff"},
    secondary:{background:C.input,color:C.text,border:`1px solid ${C.border}`},
    success:{background:C.green+"22",color:C.green,border:`1px solid ${C.green}44`},
    danger:{background:C.red+"22",color:C.red,border:`1px solid ${C.red}44`}};
  return <button onClick={onClick} style={{...base,...v[variant]}}>{children}</button>;
}

function Badge({color,children}){
  return <span style={{background:color+"22",color,border:`1px solid ${color}44`,borderRadius:20,fontSize:10,padding:"2px 8px",fontWeight:600}}>{children}</span>;
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
      const [q,hist]=await Promise.all([fetchQuote(tick),fetchHistPrices(tick)]);
      if(q){onPreco(String(q));setStatus("ok");}else{setStatus("error");}
      if(hist&&hist.length>10){const hv=calcHistVol(hist);if(hv)onHistVol(hv.toFixed(1));}
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
          <input value={ativo} onChange={e=>{onAtivo(e.target.value.toUpperCase());setStatus("idle");}}
            placeholder="PETR4" style={iS()}/>
        </Fld>
        <Fld label="Tipo">
          <select value={tipo} onChange={e=>onTipo(e.target.value)} style={iS()}>
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </Fld>
      </div>
      <Fld label="Preço atual" hint={status==="ok"?`R$ ${preco} — Brapi`:status==="error"?"Não encontrado — digite manualmente":"Buscado automaticamente"}>
        <div style={{display:"flex",gap:6}}>
          <div style={{position:"relative",flex:1}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>R$</span>
            <input type="number" value={preco} onChange={e=>onPreco(e.target.value)}
              placeholder="automático" style={iS({paddingLeft:26})}/>
          </div>
          <Btn onClick={()=>buscar(ativo)} variant="secondary" style={{padding:"0 12px",minWidth:60}}>
            {status==="loading"?"...":status==="ok"?"✓":status==="error"?"✗":"↻"}
          </Btn>
        </div>
      </Fld>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <Fld label="Vol. histórica (auto)" hint="Calculada dos últimos 3 meses via Brapi">
          <div style={{position:"relative"}}>
            <input type="number" value={histVol} onChange={e=>onHistVol(e.target.value)}
              placeholder="calculando..." style={iS({paddingRight:22,background:C.green+"11",border:`1px solid ${C.green}33`})}/>
            <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>%</span>
          </div>
        </Fld>
        <Fld label="Selic anual" hint="14% = 0.1400">
          <input type="number" value={taxa} onChange={e=>onTaxa(e.target.value)}
            placeholder="0.1400" style={iS({border:`1px solid ${C.accent}44`,background:C.accent+"11"})}/>
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
                  <input type="number" value={strike} onChange={e=>setStrike(e.target.value)} placeholder="45.05" style={iS({paddingLeft:26})}/>
                </div>
              </Fld>
              <Fld label="Prêmio atual — bid no Profit">
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:12}}>R$</span>
                  <input type="number" value={premio} onChange={e=>setPremio(e.target.value)} placeholder="1.44" style={iS({paddingLeft:26})}/>
                </div>
              </Fld>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Fld label="Vencimento" hint={dias>0?`${dias} dias`:""}>
                  <input type="date" value={dataVenc} onChange={e=>setDataVenc(e.target.value)} style={iS()}/>
                </Fld>
                <Fld label="Quantidade">
                  <input type="number" value={qtd} onChange={e=>setQtd(e.target.value)} placeholder="100" style={iS()}/>
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
          <Card style={{padding:60,textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>📊</div>
            <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>Preencha os dados ao lado</div>
            <div style={{fontSize:12,color:C.muted}}>Vol. histórica calculada automaticamente · IV via Black-Scholes · Comparação vs Selic 14%</div>
          </Card>
        ):(
          <>
            {/* Verdict */}
            <div style={{background:vc+"11",border:`2px solid ${vc}44`,borderRadius:12,padding:"14px 18px",
              marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px"}}>Decisão</div>
                <div style={{fontSize:24,fontWeight:800,color:vc}}>{result.dec.verdict}</div>
              </div>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{textAlign:"center",padding:"6px 14px",background:C.input,borderRadius:8,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.muted}}>SELIC {result.dias}d</div>
                  <div style={{fontSize:15,fontWeight:700,color:C.muted}}>{result.dec.sp.toFixed(2)}%</div>
                </div>
                <div style={{textAlign:"center",padding:"6px 14px",background:vc+"11",borderRadius:8,border:`1px solid ${vc}44`}}>
                  <div style={{fontSize:9,color:C.muted}}>PRÊMIO</div>
                  <div style={{fontSize:15,fontWeight:700,color:vc}}>{result.pp.toFixed(2)}%</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,color:C.muted}}>Score</div>
                  <div style={{fontSize:26,fontWeight:800,color:vc}}>{result.dec.score>0?"+":""}{result.dec.score}</div>
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
                  <div key={l} style={{background:C.input,borderRadius:8,padding:10,textAlign:"center"}}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:3}}>{l}</div>
                    <div style={{fontSize:16,fontWeight:700,color:c}}>R$ {v.toFixed(2)}</div>
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
                  <input type="date" value={dataVenc} onChange={e=>setDataVenc(e.target.value)} style={iS()}/>
                </Fld>
                <Fld label="Quantidade">
                  <input type="number" value={qtd} onChange={e=>setQtd(e.target.value)} placeholder="100" style={iS()}/>
                </Fld>
              </div>
              <SectionTitle>Strikes para comparar</SectionTitle>
              {[0,1,2,3].map(i=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:11}}>K</span>
                    <input type="number" value={strikes[i]} placeholder={`Strike ${i+1}`}
                      onChange={e=>{const s=[...strikes];s[i]=e.target.value;setStrikes(s);}}
                      style={iS({paddingLeft:20,fontSize:12})}/>
                  </div>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:11}}>R$</span>
                    <input type="number" value={premios[i]} placeholder="Prêmio"
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
          <Card style={{padding:60,textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>⚖️</div>
            <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>Compare até 4 strikes</div>
            <div style={{fontSize:12,color:C.muted}}>Preencha os strikes e prêmios ao lado — o sistema calcula tudo e mostra o melhor</div>
          </Card>
        ):(
          <Card style={{overflowX:"auto"}}>
            <SectionTitle>Comparativo de Strikes</SectionTitle>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr>
                  {cols.map(c=>(
                    <th key={c} style={{padding:"8px 10px",background:C.input,color:C.muted,
                      textAlign:"center",fontSize:10,textTransform:"uppercase",letterSpacing:"0.5px",
                      border:`1px solid ${C.border}`}}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r,i)=>{
                  const adelta=Math.abs(r.g.delta);
                  const deltaCol=adelta>=0.25&&adelta<=0.35?C.green:adelta>0.45?C.red:C.yellow;
                  const rnCol=r.rn>=r.sp*1.5?C.green:r.rn>=r.sp?C.yellow:C.red;
                  return(
                    <tr key={i} style={{background:i%2===0?C.card:"#1a2030"}}>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,fontWeight:700,color:C.text}}>R$ {r.K.toFixed(2)}</td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.text}}>R$ {r.pv.toFixed(2)}</td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,
                        color:r.iv>parseFloat(histVol)+8?C.green:r.iv<parseFloat(histVol)?C.red:C.yellow,fontWeight:600}}>
                        {r.iv.toFixed(1)}%
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,color:deltaCol,fontWeight:600}}>
                        {(r.g.delta*100).toFixed(1)}
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,
                        color:r.g.probOTM>=70?C.green:r.g.probOTM>=55?C.yellow:C.red,fontWeight:600}}>
                        {r.g.probOTM.toFixed(0)}%
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.green}}>
                        R$ {Math.abs(r.g.theta*r.q).toFixed(2)}
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,color:rnCol,fontWeight:700}}>
                        {r.rn.toFixed(2)}%
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,
                        color:r.rn>=r.sp*1.5?C.green:r.rn>=r.sp?C.yellow:C.red}}>
                        {(r.rn/r.sp).toFixed(1)}×
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.muted}}>
                        R$ {r.peq.toFixed(2)}
                      </td>
                      <td style={{padding:"10px",textAlign:"center",border:`1px solid ${C.border}`}}>
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
            {posicoes.length} posição(ões) · Nocional total: <span style={{color:C.accent}}>R$ {totalNocional.toFixed(0)}</span> · Prêmio recebido: <span style={{color:C.green}}>R$ {totalPremio.toFixed(2)}</span>
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
            <Fld label="Ativo"><input value={form.ativo} onChange={e=>setF("ativo",e.target.value.toUpperCase())} placeholder="PETR4" style={iS()}/></Fld>
            <Fld label="Tipo">
              <select value={form.tipo} onChange={e=>setF("tipo",e.target.value)} style={iS()}>
                <option value="call">Call Coberta</option>
                <option value="put">Put Vendida</option>
              </select>
            </Fld>
            <Fld label="Strike"><input type="number" value={form.strike} onChange={e=>setF("strike",e.target.value)} placeholder="45.05" style={iS()}/></Fld>
            <Fld label="Prêmio recebido/ação"><input type="number" value={form.premio} onChange={e=>setF("premio",e.target.value)} placeholder="1.44" style={iS()}/></Fld>
            <Fld label="Quantidade"><input type="number" value={form.qtd} onChange={e=>setF("qtd",e.target.value)} placeholder="100" style={iS()}/></Fld>
            <Fld label="Vencimento"><input type="date" value={form.dataVenc} onChange={e=>setF("dataVenc",e.target.value)} style={iS()}/></Fld>
            <Fld label="Preço de entrada do ativo"><input type="number" value={form.precoEntrada} onChange={e=>setF("precoEntrada",e.target.value)} placeholder="41.81" style={iS()}/></Fld>
            <Fld label=""><div style={{paddingTop:18}}><Btn onClick={adicionar} style={{width:"100%"}}>Adicionar</Btn></div></Fld>
          </div>
        </Card>
      )}

      {/* Lista */}
      {posicoes.length===0?(
        <Card style={{padding:60,textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:12}}>📋</div>
          <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>Nenhuma posição aberta</div>
          <div style={{fontSize:12,color:C.muted}}>Clique em "+ Adicionar Posição" para registrar seus lançamentos</div>
        </Card>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {posicoes.map(p=>{
            const dias=diasAte(p.dataVenc);
            const alerta=dias<=5;
            const noc=p.tipo==="call"?p.precoEntrada*p.qtd:p.strike*p.qtd;
            const premioTotal=p.premio*p.qtd;
            const retorno=(premioTotal/noc)*100;
            return(
              <Card key={p.id} style={{border:`1px solid ${alerta?C.red+"44":C.border}`}}>
                <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                  <div style={{minWidth:80}}>
                    <div style={{fontSize:16,fontWeight:700,color:C.text}}>{p.ativo}</div>
                    <Badge color={p.tipo==="call"?C.accent:"#A78BFA"}>{p.tipo==="call"?"Call":"Put"}</Badge>
                  </div>
                  <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted}}>STRIKE</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text}}>R$ {p.strike.toFixed(2)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted}}>PRÊMIO TOTAL</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.green}}>R$ {premioTotal.toFixed(2)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted}}>NOCIONAL</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text}}>R$ {noc.toFixed(0)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted}}>RETORNO</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.yellow}}>{retorno.toFixed(2)}%</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted}}>VENCIMENTO</div>
                      <div style={{fontSize:14,fontWeight:600,color:alerta?C.red:dias<=10?C.yellow:C.text}}>
                        {dias}d {alerta?"⚠️":""}
                      </div>
                      <div style={{fontSize:10,color:C.muted}}>{p.dataVenc}</div>
                    </div>
                  </div>
                  <Btn onClick={()=>remover(p.id)} variant="danger" style={{padding:"6px 12px",fontSize:11}}>Remover</Btn>
                </div>
                {alerta&&(
                  <div style={{marginTop:10,padding:"6px 10px",background:C.red+"11",borderRadius:6,fontSize:11,color:C.red}}>
                    ⚠️ Vence em {dias} dia(s) — decida: fechar, rolar ou deixar expirar
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
                  <input type="number" value={strikeAtual} onChange={e=>setStrikeAtual(e.target.value)} placeholder="45.05" style={iS()}/>
                </Fld>
                <Fld label="Prêmio original">
                  <input type="number" value={premioOriginal} onChange={e=>setPremioOriginal(e.target.value)} placeholder="1.44" style={iS()}/>
                </Fld>
              </div>
              <Fld label="Custo recompra atual" hint="Prêmio atual no mercado para fechar">
                <input type="number" value={premioRecompra} onChange={e=>setPremioRecompra(e.target.value)} placeholder="0.36" style={iS()}/>
              </Fld>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <Fld label="Novo strike">
                  <input type="number" value={novoStrike} onChange={e=>setNovoStrike(e.target.value)} placeholder="46.00" style={iS()}/>
                </Fld>
                <Fld label="Quantidade">
                  <input type="number" value={qtd} onChange={e=>setQtd(e.target.value)} placeholder="100" style={iS()}/>
                </Fld>
              </div>
              <SectionTitle>Opções de Rolagem</SectionTitle>
              {[0,1,2].map(i=>(
                <div key={i} style={{marginBottom:8}}>
                  <div style={{fontSize:10,color:C.muted,marginBottom:4}}>OPÇÃO {i+1}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                    <input type="date" value={novasVenc[i]}
                      onChange={e=>{const v=[...novasVenc];v[i]=e.target.value;setNovasVenc(v);}} style={iS({fontSize:12})}/>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:11}}>R$</span>
                      <input type="number" value={novosPremios[i]} placeholder="novo prêmio"
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
          <Card style={{padding:60,textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>🔄</div>
            <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:6}}>Simule sua rolagem</div>
            <div style={{fontSize:12,color:C.muted}}>Preencha a posição atual e até 3 opções de rolagem — o sistema calcula qual compensa mais</div>
          </Card>
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
                      <div key={i} style={{background:vale?C.green+"0A":C.red+"0A",
                        border:`1px solid ${vale?C.green+"44":C.red+"33"}`,borderRadius:10,padding:14}}>
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
              <select value={form.mes} onChange={e=>setF("mes",e.target.value)} style={iS()}>
                <option value="">Selecione</option>
                {meses.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            </Fld>
            <Fld label="Resultado líq. (R$)">
              <input type="number" value={form.resultado} onChange={e=>setF("resultado",e.target.value)} placeholder="267.76" style={iS()}/>
            </Fld>
            <Fld label="Meta mensal (R$)">
              <input type="number" value={form.meta} onChange={e=>setF("meta",e.target.value)} placeholder="2000" style={iS()}/>
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
                {d.hasData&&<div style={{fontSize:9,fontWeight:700,color:col}}>{d.resultado>=0?"+":""}{d.resultado?.toFixed(0)}</div>}
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
                <th key={h} style={{padding:"7px 10px",background:C.input,color:C.muted,textAlign:"center",
                  fontSize:10,textTransform:"uppercase",letterSpacing:"0.5px",border:`1px solid ${C.border}`}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d,i)=>(
              <tr key={i} style={{background:i%2===0?C.card:"#1a2030"}}>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,fontWeight:600,color:C.text}}>{d.mes}/{ano}</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,
                  color:!d.hasData?C.muted:d.resultado>=0?C.green:C.red,fontWeight:d.hasData?700:400}}>
                  {d.hasData?`R$ ${d.resultado?.toFixed(2)}`:"—"}
                </td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.muted}}>R$ {d.meta.toFixed(0)}</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.muted}}>{d.selicMes.toFixed(2)}%</td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`}}>
                  {d.hasData?<Badge color={d.resultado>=d.meta?C.green:C.red}>{d.resultado>=d.meta?"✓ SIM":"✗ NÃO"}</Badge>:"—"}
                </td>
                <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,
                  color:d.hasData&&d.resultado>0?d.resultado/d.selicMes>=1.5?C.green:d.resultado/d.selicMes>=1?C.yellow:C.muted:C.muted}}>
                  {d.hasData&&d.resultado>0?`${(d.resultado/d.selicMes).toFixed(1)}×`:"—"}
                </td>
              </tr>
            ))}
            <tr style={{background:C.accent+"11"}}>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,fontWeight:700,color:C.text}}>TOTAL</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,fontWeight:700,color:totalRes>=0?C.green:C.red}}>R$ {totalRes.toFixed(2)}</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.muted}}>—</td>
              <td style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.muted}}>{totalSelic.toFixed(2)}%</td>
              <td colSpan={2} style={{padding:"8px 10px",textAlign:"center",border:`1px solid ${C.border}`,color:C.muted}}>
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
// APP ROOT
// ════════════════════════════════════════════════════════════════════
const TABS=[
  {id:"analisar",label:"⚡ Analisar",comp:TabAnalisar},
  {id:"comparar",label:"⚖️ Comparar Strikes",comp:TabComparar},
  {id:"posicoes",label:"📋 Posições",comp:TabPosicoes},
  {id:"rolagem",label:"🔄 Rolagem",comp:TabRolagem},
  {id:"performance",label:"📈 Performance",comp:TabPerformance},
];

function LogoutButton(){
  const sair=async()=>{
    await fetch("/api/logout",{method:"POST"});
    window.location.href="/login";
  };
  return (
    <button onClick={sair} style={{
      marginLeft:"auto",background:"transparent",border:`1px solid ${C.border}`,
      color:C.muted,borderRadius:6,padding:"6px 12px",fontSize:11,cursor:"pointer"
    }}>Sair</button>
  );
}

export default function OpcoesApp(){
  const [tab,setTab]=useState("analisar");
  const Comp=TABS.find(t=>t.id===tab)?.comp||TabAnalisar;
  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,
                 fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      {/* Header */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"12px 24px",
                   display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:30,height:30,borderRadius:8,background:C.accent+"22",
                     display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⚡</div>
        <div>
          <div style={{fontWeight:700,fontSize:14}}>Opções B3 — Análise & Gestão</div>
          <div style={{fontSize:11,color:C.muted}}>Black-Scholes · Vol histórica automática · Selic 14%</div>
        </div>
        <LogoutButton/>
      </div>
      {/* Tabs */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"0 24px",
                   display:"flex",gap:4}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:"10px 16px",background:"transparent",border:"none",cursor:"pointer",
            fontSize:12,fontWeight:600,color:tab===t.id?C.accent:C.muted,
            borderBottom:`2px solid ${tab===t.id?C.accent:"transparent"}`,
            transition:"all 0.15s"
          }}>{t.label}</button>
        ))}
      </div>
      {/* Content */}
      <div style={{maxWidth:1200,margin:"0 auto",padding:20}}>
        <Comp/>
      </div>
    </div>
  );
}
