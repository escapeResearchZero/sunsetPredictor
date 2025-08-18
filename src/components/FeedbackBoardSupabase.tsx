
import React, { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Loader2, LocateFixed, Download, FileText, CalendarDays, MapPin } from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseConfig";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = "uploads";

type StoredFileRef = { name: string; url: string; type: string; size: number };
type Post = {
  id: string;
  created_at: string;
  date: string;
  lat?: number | null;
  lon?: number | null;
  place?: string | null;
  comment: string;
  files: StoredFileRef[];
};

/* ------- helpers ------- */
function sanitizeFileName(name: string){
  return name.normalize('NFKD').replace(/[^\w.\-]+/g, '-');
}
function uniquePath(name: string){
  const safe = sanitizeFileName(name);
  const stamp = new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
  const rand = Math.random().toString(36).slice(2,8);
  return `user-uploads/${stamp}-${rand}-${safe}`;
}
async function reverseGeocode(lat:number, lon:number): Promise<string|undefined>{
  try{
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    return j.city || j.locality || j.principalSubdivision || j.countryName;
  }catch{
    return undefined;
  }
}

export default function FeedbackBoardSupabase(){
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // form state
  const [date, setDate] = useState<string>(()=>{
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [lat, setLat] = useState<number|null>(null);
  const [lon, setLon] = useState<number|null>(null);
  const [place, setPlace] = useState<string>("");
  const [comment, setComment] = useState<string>("");

  // file capture
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const filesRef = useRef<File[]>([]);
  const inputRef = useRef<HTMLInputElement|null>(null);

  useEffect(()=>{ void refresh(); },[]);

  async function refresh(){
    setLoading(true);
    const { data, error } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false });
    if(!error){
      const rows = (data as any[]) ?? [];
      rows.forEach(r=>{
        if(!Array.isArray(r.files)){
          try{ r.files = JSON.parse(r.files); }catch{ r.files = []; }
        }
      });
      setPosts(rows as Post[]);
    }
    setLoading(false);
  }

  function useMyLocation(){
    if(!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (p)=>{
      const la = +p.coords.latitude.toFixed(5);
      const lo = +p.coords.longitude.toFixed(5);
      setLat(la); setLon(lo);
      const name = await reverseGeocode(la, lo);
      if(name) setPlace(name);
    });
  }

  /* unify file intake */
  function takeFileList(list: FileList | null){
    const arr: File[] = [];
    if(list){
      for(let i=0;i<list.length;i++){
        const f = list.item(i);
        if(f) arr.push(f);
      }
    }
    setPickedFiles(arr);
    filesRef.current = arr;
  }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>){
    takeFileList(e.target.files);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>){
    e.preventDefault();
    takeFileList(e.dataTransfer?.files ?? null);
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>){ e.preventDefault(); }

  async function uploadAll(filesToUpload: File[]): Promise<StoredFileRef[]>{
    setUploading(true);
    const out: StoredFileRef[] = [];
    for(const f of filesToUpload){
      const path = uniquePath(f.name);
      const { data, error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type || undefined });
      if(error){ setUploading(false); throw error; }
      const { data:pub } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
      out.push({ name: f.name, url: pub.publicUrl, type: f.type, size: f.size });
    }
    setUploading(false);
    return out;
  }

  async function submit(){
    const snapshot = (filesRef.current || []).slice();
    if(!comment.trim() && snapshot.length===0) return;
    setSubmitting(true);
    try{
      const uploaded = await uploadAll(snapshot);
      const payload = { date, lat, lon, place: place || null, comment: comment.trim(), files: uploaded };
      const { error } = await supabase.from("posts").insert(payload);
      if(error) throw error;
      // reset
      setComment("");
      setPickedFiles([]);
      filesRef.current = [];
      if(inputRef.current) inputRef.current.value = "";
      await refresh();
    }finally{
      setSubmitting(false);
    }
  }

  function exportJSON(){
    const blob = new Blob([JSON.stringify(posts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "feedback-posts.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="container mx-auto px-4">
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-9 h-9 text-indigo-500"/>
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 leading-tight">留言板/Board</h1>
        </div>
      </div>

      <Card className="mb-6 shadow-lg rounded-2xl">
        <CardContent className="p-4 md:p-6 grid gap-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm text-gray-600">Date / 日期</label>
              <Input type="date" value={date} onChange={e=>setDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-gray-600">Latitude / 纬度</label>
              <Input type="number" step="0.0001" value={lat ?? ""} onChange={e=>setLat(parseFloat(e.target.value))} />
            </div>
            <div>
              <label className="text-sm text-gray-600">Longitude / 经度</label>
              <Input type="number" step="0.0001" value={lon ?? ""} onChange={e=>setLon(parseFloat(e.target.value))} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-gray-600">Place / 地点名</label>
              <Input value={place} onChange={e=>setPlace(e.target.value)} placeholder="e.g., Lausanne, Switzerland"/>
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={useMyLocation} variant="secondary" className="gap-2">
                <LocateFixed className="w-4 h-4" /> 使用我的定位
              </Button>
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-600">Comment / 评论</label>
            <textarea
              className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-indigo-300"
              rows={4}
              value={comment}
              onChange={e=>setComment(e.target.value)}
              placeholder="写点什么…"
            />
          </div>

          <div className="grid gap-2">
            <div className="text-sm text-gray-600">Files / 文件</div>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={inputRef} type="file" multiple onChange={onInputChange} accept="image/*,video/*,application/pdf,.txt,.csv,.json,.zip" />
            </div>
            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              className="mt-2 rounded-xl border-2 border-dashed border-gray-300 p-6 text-sm text-gray-600 text-center"
            >
              可将文件拖拽到此区域（可选）
            </div>

            {pickedFiles.length>0 && (
              <>
                <div className="text-sm text-gray-700">已选择 {pickedFiles.length} 个文件：{pickedFiles.map(f=>f.name).join(', ')}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {pickedFiles.map((f,idx)=>{
                    const isImg = f.type.startsWith("image/");
                    const url = URL.createObjectURL(f);
                    return (
                      <div key={idx} className="rounded-xl border p-2 bg-white/70">
                        <div className="text-xs text-gray-600 truncate mb-1" title={f.name}>{f.name}</div>
                        <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
                          {isImg ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={f.name} className="object-contain w-full h-full"/>
                          ) : (
                            <div className="text-xs text-gray-500 flex items-center gap-1">
                              <FileText className="w-4 h-4"/> {Math.round(f.size/1024)} KB
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={submit} className="gap-2" disabled={submitting || uploading}>
              {(submitting || uploading) ? <Loader2 className="w-4 h-4 animate-spin"/> : null}
              发布
            </Button>
            <Button type="button" variant="secondary" onClick={()=>{ setComment(''); setPickedFiles([]); filesRef.current = []; if(inputRef.current) inputRef.current.value=''; }}>清空</Button>
            <div className="ml-auto">
              <Button type="button" variant="secondary" onClick={exportJSON} className="gap-2">
                <Download className="w-4 h-4"/> 导出 JSON
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <div className="grid gap-4">
        {loading && <div className="text-sm text-gray-600">加载中…</div>}
        {!loading && posts.length===0 && (
          <div className="text-gray-600 text-sm">暂无留言。</div>
        )}
        {posts.map(p=>(
          <Card key={p.id} className="rounded-2xl shadow-md">
            <CardContent className="p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm text-gray-500 flex items-center gap-2">
                    <CalendarDays className="w-4 h-4"/><span>{p.date}</span>
                    {(p.place || (p.lat!=null && p.lon!=null)) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-4 h-4"/>
                        <span>{p.place ?? ""}{p.place && (p.lat!=null && p.lon!=null) ? " · " : ""}{p.lat!=null && p.lon!=null ? `${p.lat}, ${p.lon}` : ""}</span>
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap text-gray-900">{p.comment || <span className="text-gray-400">(无文字)</span>}</div>
                </div>
              </div>

              {p.files?.length>0 && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {p.files.map((f,idx)=>{
                    const isImg = f.type.startsWith("image/");
                    return (
                      <a key={idx} className="rounded-xl border p-2 bg-white/70 hover:shadow-sm transition"
                         href={f.url} target="_blank" rel="noreferrer">
                        <div className="text-xs text-gray-600 truncate mb-1" title={f.name}>{f.name}</div>
                        <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
                          {isImg ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={f.url} alt={f.name} className="object-contain w-full h-full"/>
                          ) : (
                            <div className="text-xs text-gray-500 flex items-center gap-1">
                              <FileText className="w-4 h-4"/> 文件
                            </div>
                          )}
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}

              <div className="mt-2 text-[11px] text-gray-500">创建时间：{new Date(p.created_at).toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}