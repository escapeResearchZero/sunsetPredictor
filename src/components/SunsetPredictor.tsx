import React, { useEffect, useMemo, useState } from "react";
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

const defaultWeights = { highCloud: 0.35, midCloud: 0.25, lowCloud: 0.15, precip: 0.10, visibility: 0.07, wind: 0.08, aerosol: 0.00 };
type Weights = typeof defaultWeights;

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

// 0–1 → 0–100 归一化（处理 open-meteo 可能返回 0–1 的百分比）
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

/* ---------- Component ---------- */
export default function SunsetPredictor(){
  const [lat,setLat] = useState<number|null>(null);
  const [lon,setLon] = useState<number|null>(null);
  const [loading,setLoading] = useState(false);
  const [data,setData] = useState<OpenMeteoResponse|null>(null);
  const [tz,setTz] = useState<string|null>(null);
  const [days,setDays] = useState(5);
  const [weights] = useState<Weights>(defaultWeights);
  const [status,setStatus] = useState("");
  const [windowMinutes,setWindowMinutes] = useState(90);
  const [place,setPlace] = useState<string>("");
  const [openDetail, setOpenDetail] = useState<number|null>(null);

  // Geolocate
  useEffect(()=>{
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        (p)=>{ setLat(p.coords.latitude); setLon(p.coords.longitude); fetchPlaceName(p.coords.latitude, p.coords.longitude); },
        ()=>{ setLat(46.5197); setLon(6.6323); }
      );
    } else { setLat(46.5197); setLon(6.6323); }
  },[]);
  useEffect(()=>{ if(lat==null||lon==null) return; const id=setTimeout(()=>fetchPlaceName(lat,lon),300); return ()=>clearTimeout(id); },[lat,lon]);

  async function fetchPlaceName(la:number, lo:number){
    try{
      const url = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
      url.searchParams.set("latitude", String(la));
      url.searchParams.set("longitude", String(lo));
      url.searchParams.set("language", "zh");
      url.searchParams.set("format", "json");
      const r = await fetch(url.toString());
      const j = await r.json();
      const first = j?.results?.[0];
      if(first){ setPlace([first.name, first.admin1, first.country_code].filter(Boolean).join(" · ")); }
      else setPlace("");
    }catch{ setPlace(""); }
  }

  async function fetchForecast(){
    if(lat==null||lon==null) return;
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
  useEffect(()=>{ if(lat!=null&&lon!=null) fetchForecast(); },[lat,lon,days]);

  const sunsets = useMemo<SunsetItem[]>(()=>{
    if(!data||lat==null||lon==null) return [];
    const t = data.hourly.time.map(s=>new Date(s));
    const out:SunsetItem[]=[]; const today=new Date();

    for(let d=0; d<days; d++){
      const day=new Date(today); day.setDate(today.getDate()+d);
      const sunset = SunCalc.getTimes(day, lat, lon).sunset;
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

      // === 标准化得分 s_i（0–1） ===
      const sHigh = ccHigh==null?0.5:tri(ccHigh,50,40);     // 高云 ~50% 最优
      const sMid  = ccMid==null?0.5:tri(ccMid,40,35);       // 中云 ~40% 最优
      const sLow  = ccLow==null?0.5:1 - tri(ccLow,20,25);   // 低云越少越好
      const sPre  = pPrecip==null?0.6:1 - clamp(pPrecip/100,0,1); // 降水越少越好
      const sVis  = visKm==null?0.6:clamp((visKm-5)/10,0,1);      // 5→15km 线性加分
      const sWind = wind==null?0.6:tri(wind,4,4);                 // ~4 m/s 最优
      const sAod  = 0.6; // 预留

      const w=weights;
      const parts = [
        { key:"high", label:"High cloud / 高云",           s:sHigh, w:w.highCloud,  note: ccHigh==null ? "No data / 无数据" : undefined },
        { key:"mid",  label:"Mid cloud / 中云",            s:sMid,  w:w.midCloud,   note: ccMid==null  ? "No data / 无数据" : undefined },
        { key:"low",  label:"Low cloud / 低云",            s:sLow,  w:w.lowCloud,   note: ccLow==null  ? "No data / 无数据" : undefined },
        { key:"pre",  label:"Precip prob / 降水概率",      s:sPre,  w:w.precip,     note: pPrecip==null? "No data / 无数据" : undefined },
        { key:"vis",  label:"Visibility / 能见度",         s:sVis,  w:w.visibility, note: visKm==null  ? "No data / 无数据" : undefined },
        { key:"wind", label:"Wind / 风速",                 s:sWind, w:w.wind,       note: wind==null   ? "No data / 无数据" : undefined },
        { key:"aod",  label:"Aerosol / 气溶胶(占位)",      s:sAod,  w:w.aerosol,    note: "Not wired yet / 暂未接入" },
      ].map(it => ({ ...it, contribution: Math.round(it.s * it.w * 1000)/10 })); // 保留 0.1

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
  },[data,lat,lon,days,weights,windowMinutes]);

  const canQuery = lat!=null && lon!=null;

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
              <Button onClick={()=>navigator.geolocation?.getCurrentPosition((p)=>{ setLat(p.coords.latitude); setLon(p.coords.longitude); fetchPlaceName(p.coords.latitude, p.coords.longitude); })} variant="secondary" className="gap-2">
                <LocateFixed className="w-4 h-4"/> 定位
              </Button>
              <Button onClick={fetchForecast} disabled={!canQuery || loading} className="gap-2">
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
              <div className="flex items-center gap-2"><Info className="w-4 h-4"/>{status || (tz ? `时区 / Timezone：${tz}` : "准备就绪 / Ready")}</div>
              <div className="pl-6">位置 / Location：{place || "—（未知 / Unknown）"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!data && (<div className="text-sm text-gray-700 flex items-center gap-2"><Cloud className="w-4 h-4"/> 输入坐标并点击「获取预报」。</div>)}

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

                {/* 主体：左侧三色圆环 + 右侧指标卡片 */}
                <div className="grid grid-cols-[180px_1fr] gap-6 items-center">
                  <CloudDonut size={180} high={s.highPct??0} mid={s.midPct??0} low={s.lowPct??0} />

                  <div className="grid grid-cols-1 gap-3 text-sm">
                    <StatCard title="High cloud / 高云"   agg={s.aggHigh}   unit="%" />
                    <StatCard title="Mid cloud / 中云"    agg={s.aggMid}    unit="%" />
                    <StatCard title="Low cloud / 低云"    agg={s.aggLow}    unit="%" />
                    <StatCard title="Precip prob / 降水概率" agg={s.aggPrecip} unit="%" />
                    <StatCard title="Visibility / 能见度"  agg={s.aggVisKm} unit=" km" />
                    <StatCard title="Wind / 风速"          agg={s.aggWind}  unit=" m/s" />
                  </div>
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
                          {s.explain.items.map((it)=>(
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

/* 多环圆环图（高/中/低云；百分比越大弧越长） */
function CloudDonut({ high, mid, low, size=180 }:{ high:number; mid:number; low:number; size?:number }){
  const cx=size/2, cy=size/2;
  const rings = [
    { val: clamp(high,0,100), r: size*0.42, color:"#ef4444", label:"H" },
    { val: clamp(mid ,0,100), r: size*0.30, color:"#f59e0b", label:"M" },
    { val: clamp(low ,0,100), r: size*0.18, color:"#3b82f6", label:"L" },
  ];
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rings.map((k,i)=>{
          const c=2*Math.PI*k.r; const dash=(k.val/100)*c;
          return (
            <g key={i} transform={`rotate(-90 ${cx} ${cy})`}>
              <circle cx={cx} cy={cy} r={k.r} fill="none" stroke="#f1f5f9" strokeWidth={size*0.08}/>
              <circle cx={cx} cy={cy} r={k.r} fill="none" stroke={k.color} strokeWidth={size*0.08} strokeLinecap="round"
                strokeDasharray={`${dash} ${c-dash}`} />
            </g>
          );
        })}
        {/* 中央文本 */}
        <text x={cx} y={cy-8} textAnchor="middle" fontSize={12} fill="#ef4444">H {Math.round(high)}%</text>
        <text x={cx} y={cy+6}  textAnchor="middle" fontSize={12} fill="#f59e0b">M {Math.round(mid)}%</text>
        <text x={cx} y={cy+20} textAnchor="middle" fontSize={12} fill="#3b82f6">L {Math.round(low)}%</text>
      </svg>
    </div>
  );
}

