
import React from "react";

export default function FileCaptureTest(){
  const [names, setNames] = React.useState<string[]>([]);
  const version = "FileCaptureTest v1.0";

  React.useEffect(()=>{
    console.log(version);
  }, []);

  function handleList(list: FileList | null, reason: string){
    const len = list?.length ?? 0;
    console.log(`[${version}] ${reason}: FileList length =`, len, list);
    const arr: File[] = [];
    if(list){
      for(let i=0;i<list.length;i++){
        const f = list.item(i);
        if(f) arr.push(f);
      }
    }
    console.log(`[${version}] copied:`, arr.map(f=>({name:f.name, size:f.size, type:f.type})));
    setNames(arr.map(f=>f.name));
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>){
    handleList(e.target.files, "input.onChange");
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>){
    e.preventDefault();
    if(e.dataTransfer?.files){
      handleList(e.dataTransfer.files, "drop.files");
    }else{
      console.log(`[${version}] drop: no files`);
    }
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>){ e.preventDefault(); }

  return (
    <div style={{padding:16, border:"1px solid #eee", borderRadius:12}}>
      <div style={{marginBottom:12, fontWeight:700}}>{version}</div>
      <div style={{display:"grid", gap:12}}>
        <div>
          <input type="file" multiple onChange={onChange} />
        </div>
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          style={{height:120, border:"2px dashed #888", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center"}}
        >
          拖拽文件到此区域（Drag files here）
        </div>
        <div>捕获到文件：{names.length>0 ? names.join(", ") : "—"}</div>
      </div>
    </div>
  );
}
