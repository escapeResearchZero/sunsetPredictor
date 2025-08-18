
import React, { useEffect, useMemo, useState, useRef } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { Loader2, LocateFixed, Sun, Cloud, CalendarDays, Info } from "lucide-react";
import * as SunCalc from "suncalc";

/* ---------- Types ---------- */
interface OpenMeteoHourly {
  time: string[];
  cloudcover?: number[];
  cloudcover_low?: number[];
  cloudcover_mid?: number[];
  cloudcover_high?: number[];
  precipitation_probability?: number[];
  visibility?: number[];       // meters
  wind_speed_10m?: number[];   // m/s
}
interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: OpenMeteoHourly;
}

type StatAgg = { avg?: number; min?: number; max?: number };
type ExplainRow = { key: string; label: string; s: number; w: number; contribution: number; note?: string };
type SunsetItem = {
  date: Date;
  localISO: string;
  score: number;
  label: string;
  highPct?: number; midPct?: number; lowPct?: number;
  aggHigh: StatAgg; aggMid: StatAgg; aggLow: StatAgg;
  aggPrecip: StatAgg; aggVisKm: StatAgg; aggWind: StatAgg;
  explain: { items: ExplainRow[]; total: number; formula: string; };
};

/* ---------- Weights (已去掉 aerosol) ---------- */
const defaultWeights = {
  highCloud: 0.35,
  midCloud: 0.25,
  lowCloud: 0.15,
  precip: 0.10,
  visibility: 0.07,
  wind: 0.08,
};
type Weights = typeof defaultWeights;

/* ====== 评分模型（可调；已去掉 aod） ====== */
type TriModel = { type:"tri"|"invTri"; m:number; w:number; color:string; unit:"%"|" m/s"|" km" };
type ClampUpModel = { type:"clampUp"; threshold:number; full:number; color:string; unit:"%"|" m/s"|" km" };
type ClampDownModel = { type:"clampDown"; min:number; max:number; color:string; unit:"%"|" m/s"|" km" };
type ScoreModel = TriModel | ClampUpModel | ClampDownModel;

type ScoreModels = {
  high: TriModel;
  mid: TriModel;
  low: TriModel;      // tri (低云越低越好，理想=0)
  pre: ClampDownModel;
  vis: ClampUpModel;
  wind: TriModel;
};

const defaultModels: ScoreModels = {
  high: { type:"tri",    m:50, w:20, color:"#ef4444", unit:"%" },  // 高云：理想 50% ±20
  mid:  { type:"tri",    m:40, w:20, color:"#f59e0b", unit:"%" },  // 中云：理想 40% ±20
  low:  { type:"tri",    m:0,  w:20, color:"#3b82f6", unit:"%" },  // 低云：理想 0%（越低越好）
  pre:  { type:"clampDown", min:0, max:100, color:"#22c55e", unit:"%" },     // 降水概率越小越好
  vis:  { type:"clampUp",   threshold:5, full:15, color:"#a855f7", unit:" km" }, // 能见度>5km 线性增至15km满分
  wind: { type:"tri",    m:4,  w:4,  color:"#0ea5e9", unit:" m/s" },
};

/* ---------- Utils ---------- */
function clamp(x:number,a:number,b:number){ return Math.max(a, Math.min(b,x)); }
function tri(x:number,m:number,w:number){ const d=Math.abs(x-m); return clamp(1-d/w,0,1); }
function labelFromScore(s:number){ if(s>=85)return "🔥 Fire / 火烧云"; if(s>=70)return "Great / 极佳"; if(s>=55)return "Good / 较好"; if(s>=40)return "Fair / 一般"; return "Poor / 不佳"; }
function metersToKm(m?:number){ return m==null?undefined:m/1000; }
function scoreTheme(s:number){
  if(s>=85)return{bg:"#fff1f2",fg:"#e11d48",ring:"#fecdd3"};
  if(s>=70)return{bg:"#fff7ed",fg:"#ea580c",ring:"#fed7aa"};
  if(s>=55)return{bg:"#fffbeb",fg:"#ca8a04",ring:"#fde68a"};
  if(s>=40)return{bg:"#f3f4f6",fg:"#6b7280",ring:"#e5e7eb"};
  return{bg:"#f3f4f6",fg:"#6b7280",ring:"#e5e7eb"};
}

// 0–1 → 0–100 归一化（open-meteo 有时给 0–1）
function normalizePctArray(arr:(number|undefined)[]):number[]{
  const nums = arr.filter((v):v is number => typeof v==="number");
  if(!nums.length) return [];
  const maxAbs = Math.max(...nums.map(v=>Math.abs(v)));
  return maxAbs<=1.01 ? nums.map(v=>v*100) : nums;
}
function aggPctOverIndices(source:(number|undefined)[], idx:number[]):StatAgg{
  const picked = idx.map(i=>source?.[i]).filter((v):v is number => typeof v==="number");
  if(!picked.length) return {};
  const norm = normalizePctArray(picked);
  const sum = norm.reduce((a,b)=>a+b,0);
  return { avg: sum/norm.length, min: Math.min(...norm), max: Math.max(...norm) };
}
function aggNumOverIndices(source:(number|undefined)[], idx:number[], map?:(n:number)=>number):StatAgg{
  const picked = idx.map(i=>source?.[i]).filter((v):v is number => typeof v==="number");
  if(!picked.length) return {};
  const vals = map ? picked.map(map) : picked as number[];
  const sum = vals.reduce((a,b)=>a+b,0);
  return { avg: sum/vals.length, min: Math.min(...vals), max: Math.max(...vals) };
}

/* 根据模型求 s（0–1） */
function scoreByModel(x:number|undefined, model:ScoreModel): number|undefined {
  if(x==null || Number.isNaN(x)) return undefined;
  switch(model.type){
    case "tri":     return tri(x, model.m, model.w);
    case "invTri":  return 1 - tri(x, model.m, model.w);
    case "clampUp": return clamp((x - model.threshold)/(model.full - model.threshold), 0, 1);
    case "clampDown": return 1 - clamp((x - model.min)/(model.max - model.min), 0, 1);
  }
}

/* ---------- 可视化区间类型 ---------- */
type Band = { min: number; max: number; center: number; color: string; unit: string };

/* 由 scoreModels 推导柱状图目标区间（包含单位） */
function bandFromModel(key: keyof ScoreModels, m: ScoreModels[keyof ScoreModels]): Band {
  switch (m.type) {
    case "tri":
      return {
        min: clamp(m.m - m.w, 0, key === "wind" ? 20 : 100),
        max: clamp(m.m + m.w, 0, key === "wind" ? 20 : 100),
        center: m.m,
        color: m.color,
        unit: m.unit,
      };
    case "invTri":
      return {
        min: 0,                             // 越低越好，展示 [0, m-w]
        max: clamp(m.m - m.w, 0, 100),
        center: 0,
        color: m.color,
        unit: m.unit,
      };
    case "clampUp":
      return {
        min: m.threshold,                   // 从 threshold 到 full 逐步满分
        max: m.full,
        center: m.full,
        color: m.color,
        unit: m.unit,
      };
    case "clampDown": {
      // 越小越好：展示靠近 min 的一段目标区间（20% 范围）
      const span = Math.max(0, (m.max - m.min) * 0.2);
      return {
        min: m.min,
        max: m.min + span,
        center: m.min,
        color: m.color,
        unit: m.unit,
      };
    }
  }
}

/* ---------- Component ---------- */
export default function SunsetPredictor(){
  const [lat,setLat] = useState<number|null>(null);
  const [lon,setLon] = useState<number|null>(null);
  const [place,setPlace] = useState<string|null>(null);

  const [loading,setLoading] = useState(false);
  const [data,setData] = useState<OpenMeteoResponse|null>(null);
  const [tz,setTz] = useState<string|null>(null);
  const [days,setDays] = useState(5);
  const [weights, setWeights] = useState<Weights>(defaultWeights);
  const [status,setStatus] = useState("");
  const [windowMinutes,setWindowMinutes] = useState(90);
  const [openDetail, setOpenDetail] = useState<number|null>(null);

  // 可调模型
  const [scoreModels, setScoreModels] = useState<ScoreModels>(defaultModels);

  // 导入/导出
  const fileRef = useRef<HTMLInputElement|null>(null);
  type ParamBundle = { version: 1; weights: Weights; models: ScoreModels };

  const canQuery = lat!=null && lon!=null;

  // ---- Reverse geocode (EN) & setPlace ----
  async function fetchPlaceName(la:number, lo:number){
    try{
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${la}&longitude=${lo}&localityLanguage=en`;
      const res = await fetch(url);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const name = j.city || j.locality || j.principalSubdivision || j.countryName || `${la.toFixed(4)}, ${lo.toFixed(4)}`;
      setPlace(String(name));
    }catch{
      setPlace(`${la.toFixed(4)}, ${lo.toFixed(4)}`);
    }
  }

  // ---- Geolocate once on mount (fallback Lausanne) ----
  function requestLocation(){
    if (typeof navigator !== "undefined" && (navigator as any).geolocation){
      (navigator as any).geolocation.getCurrentPosition(
        (p:any)=>{
          const la = +p.coords.latitude.toFixed(5);
          const lo = +p.coords.longitude.toFixed(5);
          setLat(la); setLon(lo);
          fetchPlaceName(la, lo);
        },
        ()=>{
          const la = 46.5197, lo = 6.6323; // Lausanne fallback
          setLat(la); setLon(lo);
          fetchPlaceName(la, lo);
        },
        { enableHighAccuracy:true, timeout:12000, maximumAge:0 }
      );
    }else{
      const la = 46.5197, lo = 6.6323;
      setLat(la); setLon(lo);
      fetchPlaceName(la, lo);
    }
  }
  useEffect(()=>{ requestLocation(); },[]);

  // If user edits lat/lon manually, refresh place name (debounced)
  useEffect(()=>{
    if(lat==null||lon==null) return;
    const id = setTimeout(()=>{ fetchPlaceName(lat, lon); }, 300);
    return ()=>clearTimeout(id);
  },[lat,lon]);

  async function fetchForecast(){
    if(!canQuery) return;
    setLoading(true); setStatus("Fetching forecast / 获取天气数据…");
    try{
      const params = new URLSearchParams({
        latitude:String(lat), longitude:String(lon),
        hourly:[
          "cloudcover","cloudcover_low","cloudcover_mid","cloudcover_high",
          "precipitation_probability","visibility","wind_speed_10m"
        ].join(","), timezone:"auto", forecast_days:String(days),
      });
      const url=`https://api.open-meteo.com/v1/forecast?${params.toString()}`;
      const res=await fetch(url);
      if(!res.ok) throw new Error(await res.text());
      const json:OpenMeteoResponse=await res.json();
      setData(json); setTz(json.timezone); setStatus("Forecast loaded / 预报已就绪");
    }catch(e:any){ console.error(e); setStatus(e?.message||"Failed to load forecast / 加载失败"); }
    finally{ setLoading(false); }
  }
  useEffect(()=>{ if(canQuery) fetchForecast(); },[lat,lon,days]);

  const sunsets = useMemo<SunsetItem[]>(()=>{
    if(!data||!canQuery) return [];
    const t = data.hourly.time.map(s=>new Date(s));
    const out:SunsetItem[]=[]; const today=new Date();

    for(let d=0; d<days; d++){
      const day=new Date(today); day.setDate(today.getDate()+d);
      const sunset = SunCalc.getTimes(day, lat!, lon!).sunset;
      const windowStart = new Date(sunset.getTime() - windowMinutes*60*1000);
      const windowEnd   = new Date(sunset.getTime() + windowMinutes*60*1000);

      const idx:number[]=[]; for(let i=0;i<t.length;i++){ if(t[i]>=windowStart && t[i]<=windowEnd) idx.push(i); }
      if(!idx.length) continue;

      // 聚合统计
      const aggHigh  = aggPctOverIndices(data.hourly.cloudcover_high ?? [], idx);
      const aggMid   = aggPctOverIndices(data.hourly.cloudcover_mid  ?? [], idx);
      const aggLow   = aggPctOverIndices(data.hourly.cloudcover_low  ?? [], idx);
      const aggPrecip= aggPctOverIndices(data.hourly.precipitation_probability ?? [], idx);
      const aggVisKm = aggNumOverIndices(data.hourly.visibility ?? [], idx, metersToKm);
      const aggWind  = aggNumOverIndices(data.hourly.wind_speed_10m ?? [], idx);

      const ccHigh=aggHigh.avg, ccMid=aggMid.avg, ccLow=aggLow.avg;
      const pPrecip=aggPrecip.avg, visKm=aggVisKm.avg, wind=aggWind.avg;

      // s_i（0–1）—— 使用 *可调* 模型 scoreModels（实时联动）
      const sHigh = scoreByModel(ccHigh, scoreModels.high) ?? 0.5;
      const sMid  = scoreByModel(ccMid,  scoreModels.mid ) ?? 0.5;
      const sLow  = scoreByModel(ccLow,  scoreModels.low ) ?? 0.5;
      const sPre  = scoreByModel(pPrecip,scoreModels.pre ) ?? 0.6;
      const sVis  = scoreByModel(visKm,  scoreModels.vis ) ?? 0.6;
      const sWind = scoreByModel(wind,   scoreModels.wind) ?? 0.6;

      const w=weights;
      const parts = [
        { key:"high", label:"High cloud / 高云",           s:sHigh, w:w.highCloud,  note: ccHigh==null ? "No data / 无数据" : undefined },
        { key:"mid",  label:"Mid cloud / 中云",            s:sMid,  w:w.midCloud,   note: ccMid==null  ? "No data / 无数据" : undefined },
        { key:"low",  label:"Low cloud / 低云",            s:sLow,  w:w.lowCloud,   note: ccLow==null  ? "No data / 无数据" : undefined },
        { key:"pre",  label:"Precip prob / 降水概率",      s:sPre,  w:w.precip,     note: pPrecip==null? "No data / 无数据" : undefined },
        { key:"vis",  label:"Visibility / 能见度",         s:sVis,  w:w.visibility, note: visKm==null  ? "No data / 无数据" : undefined },
        { key:"wind", label:"Wind / 风速",                 s:sWind, w:w.wind,       note: wind==null   ? "No data / 无数据" : undefined },
      ].map(it => ({ ...it, contribution: Math.round(it.s * it.w * 1000)/10 }));

      const score0 = parts.reduce((acc,it)=>acc+it.contribution,0);
      const score = Math.round(clamp(score0,0,100));
      const formula = parts.filter(it=>it.w>0).map(it=>`${it.w.toFixed(2)}×${it.s.toFixed(2)}`).join(" + ");

      out.push({
        date: day, localISO: sunset.toLocaleString(), score, label: labelFromScore(score),
        highPct: ccHigh, midPct: ccMid, lowPct: ccLow,
        aggHigh, aggMid, aggLow, aggPrecip, aggVisKm, aggWind,
        explain: { items: parts, total: score, formula }
      });
    }
    return out;
  // ⭐ 关键：加入 scoreModels 作为依赖，保证拖动参数/导入文件后实时更新分数与细节
  },[data,lat,lon,days,weights,windowMinutes,scoreModels]);

  /* ===== 导出 / 导入参数（权重 + 模型） ===== */
  function exportParams(){
    const bundle = { version: 1 as const, weights, models: scoreModels };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sunsetpredictor-params-v1.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function importParams(file: File){
    try{
      const text = await file.text();
      const json = JSON.parse(text);
      // 轻量校验
      if (json?.version !== 1 || !json?.weights || !json?.models) throw new Error("文件结构不符合 v1 参数格式");
      const w = json.weights as Weights;
      const m = json.models as ScoreModels;
      // 关键字段存在性检查
      const wk = ["highCloud","midCloud","lowCloud","precip","visibility","wind"];
      if (!wk.every(k => typeof (w as any)[k] === "number")) throw new Error("weights 字段缺失或类型错误");
      const mk = ["high","mid","low","pre","vis","wind"];
      if (!mk.every(k => m[k as keyof ScoreModels])) throw new Error("models 字段缺失");
      setWeights(w);
      setScoreModels(m);
      alert("参数已导入并生效。");
    }catch(e:any){
      alert(`导入失败：${e?.message || e}`);
    }finally{
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /* UI：权重 + 模型参数折叠面板（含导入/导出） */
  function WeightsAndModelsPanel(){
    const sum = (Object.values(weights) as number[]).reduce((a,b)=>a+b,0);
  
    return (
      <div className="grid gap-4">
        {/* —— 权重 —— */}
        <CollapsibleSection
          title="Weights (click to fold) / 权重 (点击收起)"
          hint={`当前合计：${sum.toFixed(2)} · 建议≈1.00`}
          storageKey="panel.weights"
          defaultOpen
        >
          <WeightRow label="High cloud 高云" value={weights.highCloud} onChange={v=>setWeights({...weights, highCloud:v})}/>
          <WeightRow label="Mid cloud 中云"  value={weights.midCloud}  onChange={v=>setWeights({...weights, midCloud:v})}/>
          <WeightRow label="Low cloud 低云"  value={weights.lowCloud}  onChange={v=>setWeights({...weights, lowCloud:v})}/>
          <WeightRow label="Precip 降水概率"   value={weights.precip}    onChange={v=>setWeights({...weights, precip:v})}/>
          <WeightRow label="Visibility 能见度" value={weights.visibility} onChange={v=>setWeights({...weights, visibility:v})}/>
          <WeightRow label="Wind 风速"        value={weights.wind}       onChange={v=>setWeights({...weights, wind:v})}/>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={()=>setWeights(defaultWeights)}>恢复默认权重</Button>
            <Button variant="secondary" onClick={()=>{
              const total = (Object.values(weights) as number[]).reduce((a,b)=>a+b,0) || 1;
              const scaled = Object.fromEntries(Object.entries(weights).map(([k,v])=>[k, v/total])) as typeof weights;
              setWeights(scaled);
            }}>归一化为 1.00</Button>
          </div>
        </CollapsibleSection>
  
        {/* —— 三角模型：高/中/低云 + 风 —— */}
        <CollapsibleSection
          title="Clouds & Wind（三角模型）"
          storageKey="panel.tri"
          defaultOpen={false}
        >
          <TriRow
            name="High / 高云"
            m={scoreModels.high.m} w={scoreModels.high.w} color={scoreModels.high.color} unit="%"
            mRange={[0,100]} wRange={[0,60]}
            onChange={(m,w)=>setScoreModels({...scoreModels, high:{...scoreModels.high, m,w}})}
          />
          <TriRow
            name="Mid / 中云"
            m={scoreModels.mid.m} w={scoreModels.mid.w} color={scoreModels.mid.color} unit="%"
            mRange={[0,100]} wRange={[0,60]}
            onChange={(m,w)=>setScoreModels({...scoreModels, mid:{...scoreModels.mid, m,w}})}
          />
          <TriRow
            name="Low / 低云（理想越低越好）"
            m={scoreModels.low.m} w={scoreModels.low.w} color={scoreModels.low.color} unit="%"
            mRange={[0,100]} wRange={[0,60]}
            onChange={(m,w)=>setScoreModels({...scoreModels, low:{...scoreModels.low, m,w}})}
          />
          <TriRow
            name="Wind / 风速"
            m={scoreModels.wind.m} w={scoreModels.wind.w} color={scoreModels.wind.color} unit=" m/s"
            mRange={[0,20]} wRange={[0,10]}
            onChange={(m,w)=>setScoreModels({...scoreModels, wind:{...scoreModels.wind, m,w}})}
          />
        </CollapsibleSection>
  
        {/* —— 阈值模型：降水 + 能见度 —— */}
        <CollapsibleSection
          title="Precip & Visibility（阈值模型）"
          storageKey="panel.thresholds"
          defaultOpen={false}
        >
          <ClampDownRow
            name="Precip / 降水概率（越小越好）"
            min={scoreModels.pre.min} max={scoreModels.pre.max} unit="%"
            minRange={[0,100]} maxRange={[0,100]}
            onChange={(min,max)=>setScoreModels({...scoreModels, pre:{...scoreModels.pre, min, max}})}
          />
          <ClampUpRow
            name="Visibility / 能见度（高于阈值逐步满分）"
            threshold={scoreModels.vis.threshold} full={scoreModels.vis.full} unit=" km"
            thrRange={[0,30]} fullRange={[1,100]}
            onChange={(thr,full)=>setScoreModels({...scoreModels, vis:{...scoreModels.vis, threshold:thr, full}})}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportParams}>导出参数 (JSON)</Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e)=>{ const f = e.target.files?.[0]; if(f) importParams(f); }}
            />
            <Button variant="secondary" onClick={()=>fileRef.current?.click()}>导入参数 (JSON)</Button>
            <Button variant="secondary" onClick={()=>{
              setWeights(defaultWeights);
              setScoreModels(defaultModels);
            }}>恢复默认模型与权重</Button>
          </div>
        </CollapsibleSection>
      </div>
    );
  }
  

  /* 计算所有因子的 band（含单位）供 Bar 使用 */
  const bandsAll: Record<string, Band> = useMemo(()=>({
    high: bandFromModel("high", scoreModels.high),
    mid:  bandFromModel("mid",  scoreModels.mid),
    low:  bandFromModel("low",  scoreModels.low),
    pre:  bandFromModel("pre",  scoreModels.pre),
    vis:  bandFromModel("vis",  scoreModels.vis),
    wind: bandFromModel("wind", scoreModels.wind),
  }), [scoreModels]);

  return (
    <div className="container mx-auto px-4">
      {/* 标题 */}
      <div className="flex items-center gap-3 mb-6">
        <Sun className="w-9 h-9 text-orange-500" />
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 leading-tight">Sunset Predictor</h1>
          <p className="text-sm text-gray-600 -mt-1">火烧云/晚霞拍摄参考</p>
        </div>
      </div>

      {/* 控制面板 */}
      <Card className="mb-6 shadow-lg rounded-2xl">
        <CardContent className="p-4 md:p-6 grid gap-4">
          {/* 顶部：自动定位提示 + 重新定位按钮 */}
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>
              位置 / Location：{place ?? (lat!=null && lon!=null ? `${lat.toFixed(5)}, ${lon?.toFixed(5)}` : "—")}
            </div>
            <Button onClick={requestLocation} variant="secondary" className="gap-2">
              <LocateFixed className="w-4 h-4"/> 重新定位
            </Button>
          </div>

          {/* 手动输入 + 拉取按钮 */}
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-sm text-gray-600">Latitude / 纬度</label>
              <Input type="number" step="0.0001" value={lat ?? ''} onChange={(e)=>setLat(parseFloat(e.target.value))}/>
            </div>
            <div>
              <label className="text-sm text-gray-600">Longitude / 经度</label>
              <Input type="number" step="0.0001" value={lon ?? ''} onChange={(e)=>setLon(parseFloat(e.target.value))}/>
            </div>
            <div className="flex gap-2">
              <Button onClick={fetchForecast} disabled={! (lat!=null && lon!=null) || loading} className="gap-2">
                {loading ? (<><Loader2 className="w-4 h-4 animate-spin"/> 加载…</>) : (<>获取预报</>)}
              </Button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-3 rounded-2xl bg-white shadow-sm">
              <div className="mb-2 text-sm text-gray-600">Days / 预测天数：{days}</div>
              <Slider value={[days]} min={1} max={10} step={1} onValueChange={(v)=>setDays(v[0])}/>
            </div>
            <div className="p-3 rounded-2xl bg-white shadow-sm">
              <div className="mb-2 text-sm text-gray-600">Window / 可视窗口（±分钟）：{windowMinutes}</div>
              <Slider value={[windowMinutes]} min={30} max={150} step={15} onValueChange={(v)=>setWindowMinutes(v[0])}/>
            </div>
            <div className="p-3 rounded-2xl bg-white shadow-sm text-sm text-gray-600 flex flex-col gap-1 col-span-full">
              <div className="flex items-center gap-2"><Info className="w-4 h-4"/>{(tz && `时区 / Timezone：${tz}`) || "准备就绪 / Ready"}</div>
            </div>

            {/* 参数折叠面板 */}
            <div className="col-span-full">
              {WeightsAndModelsPanel()}
            </div>
          </div>
        </CardContent>
      </Card>

      {!data && (<div className="text-sm text-gray-700 flex items-center gap-2"><Cloud className="w-4 h-4"/> 自动或手动设置坐标后点击「获取预报」。</div>)}

      <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {sunsets.map((s, idx) => {
          const theme = scoreTheme(s.score);
          return (
            <Card key={idx} className="overflow-hidden shadow-md hover:shadow-xl transition rounded-2xl">
              <CardContent className="p-5">
                {/* 顶部日期 + 成绩 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-gray-700"/>
                    <div>
                      <div className="text-lg font-semibold text-gray-900">
                        {s.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      </div>
                      <div className="text-xs text-gray-600">日落 / Sunset: {s.localISO}（±{windowMinutes} 分钟）</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div style={{background:theme.bg,color:theme.fg,borderColor:theme.ring}} className="inline-flex items-baseline gap-1 border rounded-full px-3 py-1">
                      <span className="text-lg font-bold">{s.score}</span>
                      <span className="text-xs opacity-70">/100</span>
                    </div>
                    <div className="text-sm" style={{color:theme.fg}}>{s.label}</div>
                  </div>
                </div>

                {/* 顶部横向柱状图：显示所有因子（无 aod） */}
                <CloudBars
                  values={{
                    high: s.highPct ?? 0,           // %
                    mid:  s.midPct ?? 0,            // %
                    low:  s.lowPct ?? 0,            // %
                    pre:  s.aggPrecip.avg ?? 0,     // %
                    vis:  s.aggVisKm.avg ?? 0,      // km
                    wind: s.aggWind.avg ?? 0,       // m/s
                  }}
                  bands={bandsAll}
                />

                {/* 指标卡片：在小屏单列，大屏两列 */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <StatCard title="High cloud / 高云"   agg={s.aggHigh}   unit="%" />
                  <StatCard title="Mid cloud / 中云"    agg={s.aggMid}    unit="%" />
                  <StatCard title="Low cloud / 低云"    agg={s.aggLow}    unit="%" />
                  <StatCard title="Precip prob / 降水概率" agg={s.aggPrecip} unit="%" />
                  <StatCard title="Visibility / 能见度"  agg={s.aggVisKm} unit=" km" />
                  <StatCard title="Wind / 风速"          agg={s.aggWind}  unit=" m/s" />
                </div>

                {/* 计算细节：按钮 + 折叠 */}
                <div className="mt-4">
                  <Button variant="secondary" className="text-xs"
                    onClick={()=>setOpenDetail(openDetail===idx?null:idx)}>
                    {openDetail===idx ? "隐藏计算细节 / Hide details" : "查看计算细节 / Show details"}
                  </Button>
                </div>

                {openDetail===idx && (
                  <div className="mt-3 rounded-xl border border-gray-100 bg-white/70 p-3 text-xs text-gray-700 space-y-2">
                    <div><b>公式 / Formula：</b> Score = 100 × ( {s.explain.formula} )</div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="py-1 pr-3">因子 / Factor</th>
                            <th className="py-1 pr-3">标准化 s</th>
                            <th className="py-1 pr-3">权重 w</th>
                            <th className="py-1 pr-3">贡献 w×s×100</th>
                            <th className="py-1">说明 / Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.explain.items.map((it)=> (
                            <tr key={it.key} className="border-t">
                              <td className="py-1 pr-3">{it.label}</td>
                              <td className="py-1 pr-3">{it.s.toFixed(2)}</td>
                              <td className="py-1 pr-3">{it.w.toFixed(2)}</td>
                              <td className="py-1 pr-3">{it.contribution.toFixed(1)}</td>
                              <td className="py-1">{it.note ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div><b>总分 / Total：</b> {s.explain.total} / 100</div>
                    <div className="text-[11px] text-gray-500">
                      注：s 为 0–1 标准化得分，w 为权重。缺失项用中性值处理并在 Note 中标注。<br/>
                      Note: s normalized to [0–1]; w is weight. Missing inputs fall back to neutral (see Note).
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- UI helpers ---------- */
function StatCard({ title, agg, unit }:{ title:string; agg:StatAgg; unit:string; }){
  const fmt = (n?:number)=> n==null ? "—" : (unit.trim()==="%" ? `${Math.round(n)}%` : `${Math.round(n)}${unit}`);
  return (
    <div className="rounded-xl border border-gray-100 bg-white/70 px-4 py-3 shadow-sm">
      <div className="text-gray-700">{title}</div>
      <div className="mt-1 flex items-baseline justify-between">
        <div className="text-xs text-gray-500">Min 最小 {fmt(agg.min)} · Max 最大 {fmt(agg.max)}</div>
        <div className="text-sm font-semibold text-gray-900">Avg 平均 {fmt(agg.avg)}</div>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title, hint, storageKey, defaultOpen = false, children
}:{
  title: string;
  hint?: string;
  storageKey: string;         // 记忆展开状态的 key
  defaultOpen?: boolean;
  children: React.ReactNode;
}){
  const [open, setOpen] = React.useState<boolean>(defaultOpen);

  // 客户端挂载后再恢复本地状态
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved != null) setOpen(saved === "1");
    } catch {}
  }, [storageKey]);

  // 状态变更后再写回本地
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, open ? "1" : "0");
    } catch {}
  }, [open, storageKey]);

  return (
    <details
      className="rounded-2xl bg-white/70 border border-gray-100 p-3"
      open={open}
      onToggle={(e)=>setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none flex items-center justify-between">
        <span className="text-sm font-medium text-gray-800">{title}</span>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
      </summary>
      <div className="mt-3 grid gap-3">{children}</div>
    </details>
  );
}


function WeightRow({label, value, onChange}:{label:string; value:number; onChange:(v:number)=>void}){
  return (
    <div className="grid grid-cols-12 items-center gap-2">
      <div className="col-span-4 text-xs text-gray-700">{label}</div>
      <div className="col-span-6">
        <Slider value={[value]} min={0} max={1} step={0.01} onValueChange={(v)=>onChange(+v[0])}/>
      </div>
      <div className="col-span-2">
        <Input type="number" step="0.01" value={value} onChange={(e)=>onChange(parseFloat(e.target.value||"0"))}/>
      </div>
    </div>
  );
}

function TriRow({
  name, m, w, color, unit, mRange, wRange, onChange
}:{
  name:string; m:number; w:number; color:string; unit:string;
  mRange:[number,number]; wRange:[number,number];
  onChange:(m:number,w:number)=>void;
}){
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-gray-700">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full" style={{background:color}} />
          <span>{name}</span>
        </div>
        <div className="text-[11px] text-gray-500">ideal={m}{unit} · tolerance={w}{unit}</div>
      </div>
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-2 text-[11px] text-gray-600">ideal</div>
        <div className="col-span-8"><Slider value={[m]} min={mRange[0]} max={mRange[1]} step={1} onValueChange={(v)=>onChange(+v[0], w)}/></div>
        <div className="col-span-2"><Input type="number" value={m} onChange={(e)=>onChange(parseFloat(e.target.value||"0"), w)}/></div>
      </div>
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-2 text-[11px] text-gray-600">tolerance</div>
        <div className="col-span-8"><Slider value={[w]} min={wRange[0]} max={wRange[1]} step={1} onValueChange={(v)=>onChange(m, +v[0])}/></div>
        <div className="col-span-2"><Input type="number" value={w} onChange={(e)=>onChange(m, parseFloat(e.target.value||"0"))}/></div>
      </div>
    </div>
  );
}

function ClampDownRow({
  name, min, max, unit, minRange, maxRange, onChange
}:{
  name:string; min:number; max:number; unit:string;
  minRange:[number,number]; maxRange:[number,number];
  onChange:(min:number,max:number)=>void;
}){
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-gray-700">
        <div>{name}</div>
        <div className="text-[11px] text-gray-500">min={min}{unit} · max={max}{unit}</div>
      </div>
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-2 text-[11px] text-gray-600">min</div>
        <div className="col-span-8"><Slider value={[min]} min={minRange[0]} max={minRange[1]} step={1} onValueChange={(v)=>onChange(+v[0], max)}/></div>
        <div className="col-span-2"><Input type="number" value={min} onChange={(e)=>onChange(parseFloat(e.target.value||"0"), max)}/></div>
      </div>
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-2 text-[11px] text-gray-600">max</div>
        <div className="col-span-8"><Slider value={[max]} min={maxRange[0]} max={maxRange[1]} step={1} onValueChange={(v)=>onChange(min, +v[0])}/></div>
        <div className="col-span-2"><Input type="number" value={max} onChange={(e)=>onChange(min, parseFloat(e.target.value||"0"))}/></div>
      </div>
    </div>
  );
}

function ClampUpRow({
  name, threshold, full, unit, thrRange, fullRange, onChange
}:{
  name:string; threshold:number; full:number; unit:string;
  thrRange:[number,number]; fullRange:[number,number];
  onChange:(threshold:number, full:number)=>void;
}){
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-xs text-gray-700">
        <div>{name}</div>
        <div className="text-[11px] text-gray-500">threshold={threshold}{unit} · full={full}{unit}</div>
      </div>
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-2 text-[11px] text-gray-600">threshold</div>
        <div className="col-span-8"><Slider value={[threshold]} min={thrRange[0]} max={thrRange[1]} step={1} onValueChange={(v)=>onChange(+v[0], full)}/></div>
        <div className="col-span-2"><Input type="number" value={threshold} onChange={(e)=>onChange(parseFloat(e.target.value||"0"), full)}/></div>
      </div>
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-2 text-[11px] text-gray-600">full</div>
        <div className="col-span-8"><Slider value={[full]} min={fullRange[0]} max={fullRange[1]} step={1} onValueChange={(v)=>onChange(threshold, +v[0])}/></div>
        <div className="col-span-2"><Input type="number" value={full} onChange={(e)=>onChange(threshold, parseFloat(e.target.value||"0"))}/></div>
      </div>
    </div>
  );
}

/* 全部因子横向柱状图（灰带→柱→理想线；按单位归一） */
// 固定坐标轴范围，避免不同单位导致柱宽不一致
const FIXED_DOMAINS: Record<string, [number, number]> = {
  high: [0, 100],   // %
  mid:  [0, 100],   // %
  low:  [0, 100],   // %
  pre:  [0, 100],   // 降水概率 %
  vis:  [0, 40],    // km（可按需调整，如 0–30/50）
  wind: [0, 20],    // m/s
};

function CloudBars({
  values,
  bands
}:{
  values: Record<string, number>;
  bands: Record<string, Band>;
}){
  const items = [
    { key:"high", label:"High / 高云" },
    { key:"mid",  label:"Mid / 中云" },
    { key:"low",  label:"Low / 低云" },
    { key:"pre",  label:"Precip / 降水概率" },
    { key:"vis",  label:"Visibility / 能见度" },
    { key:"wind", label:"Wind / 风速" },
  ] as const;

  const fmt = (val:number, unit:string)=>{
    if(unit.trim()==="%") return `${Math.round(val)}%`;
    if(unit.includes("km")) return `${Math.round(val)} km`;
    if(unit.includes("m/s")) return `${Math.round(val)} m/s`;
    return `${Math.round(val)}${unit}`;
  };

  return (
    <div className="w-full rounded-2xl border border-gray-100 bg-white/70 p-3">
      <div className="mb-2 text-sm font-medium text-gray-800">
        All factors around sunset / 日落窗所有因子
      </div>
      <div className="space-y-3">
        {items.map(item=>{

          const vRaw = values[item.key] ?? 0;
          const band = bands[item.key];
          const domain = FIXED_DOMAINS[item.key] || [0,100];
          const toPct = (val:number)=> {
            const [d0,d1] = domain;
            const p = ((val - d0) / Math.max(1e-6, (d1 - d0))) * 100;
            return Math.max(0, Math.min(100, p));
          };

          const bandLeft  = `${toPct(band.min)}%`;
          const bandRight = toPct(band.max);
          const bandWidth = `${Math.max(0, bandRight - toPct(band.min))}%`;
          const markerLeft= `${toPct(band.center)}%`;

          const widthPct  = toPct(vRaw);
          return (
            <div key={item.key}>
              <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2 w-2 rounded-full" style={{ background: band.color }} />
                  {item.label}
                </div>
                <div className="tabular-nums">
                  {fmt(vRaw, band.unit)}
                  <span className="text-gray-400"> · 目标 {fmt(band.min, band.unit)}–{fmt(band.max, band.unit)}</span>
                </div>
              </div>

              <div className="relative h-3 w-full rounded-full bg-gray-100 overflow-hidden">
                {/* 目标区间（底层） */}
                <div className="absolute top-0 bottom-0 rounded-full"
                     style={{ left: bandLeft, width: bandWidth, background: "rgba(0,0,0,0.06)" }} />
                {/* 彩色柱（中层） */}
                <div className="absolute top-0 bottom-0 rounded-full"
                     style={{ width: `${widthPct}%`, background: band.color, transition: "width 300ms ease" }} />
                {/* 理想点（最上层） */}
                <div className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-gray-800"
                     style={{ left: markerLeft }} title={`理想值 ${fmt(band.center, band.unit)}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
